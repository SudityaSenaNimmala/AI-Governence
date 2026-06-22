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

export const VERSION = '2026-05-20';

// One row per model family. `input` and `output` are USD per 1M tokens.
// `cached_input` is for prompts hitting the provider's cache (OpenAI / Anthropic
// both bill cached tokens lower). Null = use input price.
export const MODELS = [
  // ---- Anthropic ----
  { match: /^claude-opus-4-7/,                  provider: 'anthropic', family: 'claude-opus-4.7',  input: 15.00, output: 75.00, cached_input: 1.50 },
  { match: /^claude-opus-4-6/,                  provider: 'anthropic', family: 'claude-opus-4.6',  input: 15.00, output: 75.00, cached_input: 1.50 },
  { match: /^claude-opus-4/,                    provider: 'anthropic', family: 'claude-opus-4',    input: 15.00, output: 75.00, cached_input: 1.50 },
  { match: /^claude-sonnet-4-6/,                provider: 'anthropic', family: 'claude-sonnet-4.6', input: 3.00, output: 15.00, cached_input: 0.30 },
  { match: /^claude-sonnet-4/,                  provider: 'anthropic', family: 'claude-sonnet-4',  input: 3.00,  output: 15.00, cached_input: 0.30 },
  { match: /^claude-haiku-4-5/,                 provider: 'anthropic', family: 'claude-haiku-4.5', input: 1.00,  output: 5.00,  cached_input: 0.10 },
  { match: /^claude-3-5-sonnet/,                provider: 'anthropic', family: 'claude-3.5-sonnet', input: 3.00, output: 15.00, cached_input: 0.30 },
  { match: /^claude-3-5-haiku/,                 provider: 'anthropic', family: 'claude-3.5-haiku', input: 0.80,  output: 4.00,  cached_input: 0.08 },
  { match: /^claude-3-opus/,                    provider: 'anthropic', family: 'claude-3-opus',    input: 15.00, output: 75.00, cached_input: 1.50 },

  // ---- OpenAI ----
  { match: /^gpt-4o-mini/,                      provider: 'openai',    family: 'gpt-4o-mini',      input: 0.15,  output: 0.60,  cached_input: 0.075 },
  { match: /^gpt-4o/,                           provider: 'openai',    family: 'gpt-4o',           input: 2.50,  output: 10.00, cached_input: 1.25 },
  { match: /^gpt-4-turbo/,                      provider: 'openai',    family: 'gpt-4-turbo',      input: 10.00, output: 30.00, cached_input: null },
  { match: /^gpt-4(?!o|-turbo)/,                provider: 'openai',    family: 'gpt-4',            input: 30.00, output: 60.00, cached_input: null },
  { match: /^gpt-3\.5-turbo/,                   provider: 'openai',    family: 'gpt-3.5-turbo',    input: 0.50,  output: 1.50,  cached_input: null },
  { match: /^o1-mini/,                          provider: 'openai',    family: 'o1-mini',          input: 3.00,  output: 12.00, cached_input: 1.50 },
  { match: /^o1-preview/,                       provider: 'openai',    family: 'o1-preview',       input: 15.00, output: 60.00, cached_input: 7.50 },
  { match: /^o1/,                               provider: 'openai',    family: 'o1',               input: 15.00, output: 60.00, cached_input: 7.50 },
  { match: /^text-embedding-3-large/,           provider: 'openai',    family: 'embedding-3-large', input: 0.13, output: 0.00,  cached_input: null },
  { match: /^text-embedding-3-small/,           provider: 'openai',    family: 'embedding-3-small', input: 0.02, output: 0.00,  cached_input: null },

  // ---- Google ----
  { match: /^gemini-2\.5-pro/,                  provider: 'google',    family: 'gemini-2.5-pro',   input: 1.25,  output: 10.00, cached_input: 0.31 },
  { match: /^gemini-2\.5-flash/,                provider: 'google',    family: 'gemini-2.5-flash', input: 0.30,  output: 2.50,  cached_input: 0.075 },
  { match: /^gemini-1\.5-pro/,                  provider: 'google',    family: 'gemini-1.5-pro',   input: 1.25,  output: 5.00,  cached_input: 0.31 },
  { match: /^gemini-1\.5-flash/,                provider: 'google',    family: 'gemini-1.5-flash', input: 0.075, output: 0.30,  cached_input: 0.019 },
];

const UNKNOWN = { provider: 'unknown', family: 'unknown', input: 0, output: 0, cached_input: null };
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
