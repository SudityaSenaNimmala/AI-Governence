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

export function findPricing(modelName: string, vendor: "azure" | "google" | "aws"): { input: number; output: number } {
  const table = vendor === "azure" ? AZURE_PRICING : vendor === "aws" ? AWS_BEDROCK_PRICING : GOOGLE_PRICING;
  const lower = (modelName || "").toLowerCase();

  for (const [key, price] of Object.entries(table)) {
    if (lower.includes(key)) return price;
  }
  return vendor === "azure" ? { input: 2.50, output: 10.00 } : vendor === "aws" ? { input: 1.00, output: 3.00 } : { input: 0.50, output: 1.50 };
}

/**
 * Try to infer a known model name from an Azure deployment name.
 * Azure deployments are often named like "gpt-4o", "gpt-4o-deployment",
 * "my-gpt-35-turbo", etc. We match against the pricing table keys.
 */
export function inferModelFromDeploymentName(deploymentName: string, vendor: "azure" | "google" | "aws"): string | null {
  const table = vendor === "azure" ? AZURE_PRICING : vendor === "aws" ? AWS_BEDROCK_PRICING : GOOGLE_PRICING;
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
