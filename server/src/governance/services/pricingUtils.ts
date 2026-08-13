/**
 * Shared pricing tables and cost calculation utilities.
 * Used by both cost.ts (Cost tab) and activity.ts (Usage Tracking).
 */

export const AZURE_PRICING: Record<string, { input: number; output: number }> = {
  "gpt-4o":            { input: 2.50,  output: 10.00 },
  "gpt-4o-mini":       { input: 0.15,  output: 0.60  },
  "gpt-4":             { input: 30.00, output: 60.00 },
  "gpt-4-turbo":       { input: 10.00, output: 30.00 },
  "gpt-4-32k":         { input: 60.00, output: 120.00 },
  "gpt-35-turbo":      { input: 0.50,  output: 1.50  },
  "gpt-3.5-turbo":     { input: 0.50,  output: 1.50  },
  "o1":                { input: 15.00, output: 60.00 },
  "o1-mini":           { input: 3.00,  output: 12.00 },
  "o3-mini":           { input: 1.10,  output: 4.40  },
  "dall-e-3":          { input: 40.00, output: 0     },
  "text-embedding-ada-002": { input: 0.10, output: 0 },
  "text-embedding-3-small": { input: 0.02, output: 0 },
  "text-embedding-3-large": { input: 0.13, output: 0 },
  "whisper":           { input: 0.36,  output: 0     },
};

export const GOOGLE_PRICING: Record<string, { input: number; output: number }> = {
  "gemini-2.0-flash":  { input: 0.10,  output: 0.40  },
  "gemini-2.0-pro":    { input: 1.25,  output: 5.00  },
  "gemini-1.5-pro":    { input: 1.25,  output: 5.00  },
  "gemini-1.5-flash":  { input: 0.075, output: 0.30  },
  "gemini-1.0-pro":    { input: 0.50,  output: 1.50  },
  "gemini-ultra":      { input: 7.00,  output: 21.00 },
  "palm-2":            { input: 0.50,  output: 1.50  },
  "text-bison":        { input: 0.25,  output: 0.50  },
  "code-bison":        { input: 0.25,  output: 0.50  },
  "claude-3.5-sonnet": { input: 3.00,  output: 15.00 },
  "llama-3.1":         { input: 0.27,  output: 0.27  },
};

/**
 * OpenAI direct-API list prices, per 1M tokens.
 *
 * The numbers are deliberately the SAME ones AZURE_PRICING already carries for
 * the shared model names — Azure OpenAI and OpenAI publish identical list rates
 * for these deployments, and two tables quoting different figures for "gpt-4o"
 * would put two different dollar amounts on the same call depending on which
 * code path priced it. Kept as a separate table rather than an alias because the
 * two vendors' model NAMES diverge (Azure spells it "gpt-35-turbo", OpenAI
 * "gpt-3.5-turbo") and Azure carries deployments OpenAI has no equivalent for.
 */
// NOTE ON KEY ORDER: findPricing() walks a table in INSERTION order and takes
// the first key the model name contains, so a shorter key listed first wins over
// the longer key that actually describes the model ("gpt-4o" would swallow
// "gpt-4o-mini" and price a $0.15 call at $2.50). Every table below is therefore
// ordered most-specific-first. AZURE_PRICING above is not reordered here — that
// is existing behaviour other routes' figures already reflect, and changing it
// is not this feature's to make.
export const OPENAI_PRICING: Record<string, { input: number; output: number }> = {
  "gpt-4o-mini":       { input: 0.15,  output: 0.60  },
  "gpt-4o":            { input: 2.50,  output: 10.00 },
  "gpt-4-turbo":       { input: 10.00, output: 30.00 },
  "gpt-4":             { input: 30.00, output: 60.00 },
  "gpt-3.5-turbo":     { input: 0.50,  output: 1.50  },
  "o1-mini":           { input: 3.00,  output: 12.00 },
  "o1":                { input: 15.00, output: 60.00 },
  "o3-mini":           { input: 1.10,  output: 4.40  },
  "text-embedding-3-small": { input: 0.02, output: 0 },
  "text-embedding-3-large": { input: 0.13, output: 0 },
};

/**
 * Anthropic direct-API list prices, per 1M tokens.
 *
 * Same rule as above: the figures match the `anthropic.*` rows AWS_BEDROCK_PRICING
 * already uses, because Bedrock resells Anthropic at Anthropic's list price. The
 * keys are the direct-API model names (no `anthropic.` vendor prefix), which is
 * what an SDK caller sends as `model`.
 */
export const ANTHROPIC_PRICING: Record<string, { input: number; output: number }> = {
  "claude-opus-4":     { input: 15.00, output: 75.00 },
  "claude-sonnet-4":   { input: 3.00,  output: 15.00 },
  "claude-3-7-sonnet": { input: 3.00,  output: 15.00 },
  "claude-3-5-sonnet": { input: 3.00,  output: 15.00 },
  "claude-3-5-haiku":  { input: 0.80,  output: 4.00  },
  "claude-3-opus":     { input: 15.00, output: 75.00 },
  "claude-3-sonnet":   { input: 3.00,  output: 15.00 },
  "claude-3-haiku":    { input: 0.25,  output: 1.25  },
  // Bare family names, so a caller sending just "claude-opus" still prices.
  "claude-opus":       { input: 15.00, output: 75.00 },
  "claude-sonnet":     { input: 3.00,  output: 15.00 },
  "claude-haiku":      { input: 0.80,  output: 4.00  },
};

export const AWS_BEDROCK_PRICING: Record<string, { input: number; output: number }> = {
  "anthropic.claude-sonnet-4":   { input: 3.00,  output: 15.00 },
  "anthropic.claude-3-5-sonnet": { input: 3.00,  output: 15.00 },
  "anthropic.claude-3-5-haiku":  { input: 0.80,  output: 4.00  },
  "anthropic.claude-3-haiku":    { input: 0.25,  output: 1.25  },
  "anthropic.claude-3-opus":     { input: 15.00, output: 75.00 },
  "amazon.titan-text-express":   { input: 0.20,  output: 0.60  },
  "amazon.titan-text-lite":      { input: 0.15,  output: 0.20  },
  "amazon.nova-pro":             { input: 0.80,  output: 3.20  },
  "amazon.nova-lite":            { input: 0.06,  output: 0.24  },
  "amazon.nova-micro":           { input: 0.035, output: 0.14  },
  "meta.llama3-70b":             { input: 2.65,  output: 3.50  },
  "meta.llama3-8b":              { input: 0.30,  output: 0.60  },
  "mistral.mixtral-8x7b":        { input: 0.45,  output: 0.70  },
  "mistral.mistral-large":       { input: 4.00,  output: 12.00 },
  "cohere.command-r-plus":       { input: 3.00,  output: 15.00 },
  "cohere.command-r":            { input: 0.50,  output: 1.50  },
  "ai21.jamba-1-5-large":        { input: 2.00,  output: 8.00  },
};

/**
 * Look up per-1M-token pricing for a model.
 *
 * Returns `matched: false` when no table entry applies and the caller is getting
 * a generic fallback rate. That flag is the point: the fallback for Azure is
 * gpt-4o list price, so a deployment named e.g. "my-custom-model" was silently
 * priced as gpt-4o and rendered as a firm dollar figure with no estimate marker —
 * cost.ts only set `costEstimated` when the model name was literally "unknown".
 * A number that looks measured but is a guess is worse than a visible estimate.
 */
export type PricingVendor = "azure" | "google" | "aws" | "openai" | "anthropic";

const PRICING_TABLES: Record<PricingVendor, Record<string, { input: number; output: number }>> = {
  azure: AZURE_PRICING,
  google: GOOGLE_PRICING,
  aws: AWS_BEDROCK_PRICING,
  openai: OPENAI_PRICING,
  anthropic: ANTHROPIC_PRICING,
};

const PRICING_FALLBACKS: Record<PricingVendor, { input: number; output: number }> = {
  azure:     { input: 2.50,  output: 10.00 },
  aws:       { input: 1.00,  output: 3.00  },
  google:    { input: 0.50,  output: 1.50  },
  // Mid-tier list rates, so an unrecognised model is not priced at zero (which
  // reads as "free") nor at flagship rates (which reads as alarming). Either way
  // the caller gets matched:false and must mark the figure as an estimate.
  openai:    { input: 2.50,  output: 10.00 },
  anthropic: { input: 3.00,  output: 15.00 },
};

export function findPricing(
  modelName: string,
  vendor: PricingVendor,
): { input: number; output: number; matched: boolean } {
  const table = PRICING_TABLES[vendor] ?? GOOGLE_PRICING;
  const lower = (modelName || "").toLowerCase();

  for (const [key, price] of Object.entries(table)) {
    if (lower.includes(key)) return { ...price, matched: true };
  }
  return { ...(PRICING_FALLBACKS[vendor] ?? PRICING_FALLBACKS.google), matched: false };
}

/**
 * Try to infer a known model name from an Azure deployment name.
 * Azure deployments are often named like "gpt-4o", "gpt-4o-deployment",
 * "my-gpt-35-turbo", etc. We match against the pricing table keys.
 */
export function inferModelFromDeploymentName(deploymentName: string, vendor: PricingVendor): string | null {
  const table = PRICING_TABLES[vendor] ?? GOOGLE_PRICING;
  const lower = (deploymentName || "").toLowerCase();
  // Sort by key length descending so "gpt-4o-mini" matches before "gpt-4o"
  const sortedKeys = Object.keys(table).sort((a, b) => b.length - a.length);
  for (const key of sortedKeys) {
    if (lower.includes(key)) return key;
  }
  return null;
}

export function computeCost(inputTokens: number, outputTokens: number, pricing: { input: number; output: number }): number {
  return (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;
}
