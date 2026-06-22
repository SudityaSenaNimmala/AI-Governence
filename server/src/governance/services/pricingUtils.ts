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

export function findPricing(modelName: string, vendor: "azure" | "google"): { input: number; output: number } {
  const table = vendor === "azure" ? AZURE_PRICING : GOOGLE_PRICING;
  const lower = (modelName || "").toLowerCase();

  for (const [key, price] of Object.entries(table)) {
    if (lower.includes(key)) return price;
  }
  return vendor === "azure" ? { input: 2.50, output: 10.00 } : { input: 0.50, output: 1.50 };
}

export function computeCost(inputTokens: number, outputTokens: number, pricing: { input: number; output: number }): number {
  return (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;
}
