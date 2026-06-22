import type { GraphServicePrincipal } from "../types/graph.js";
import type { AiSignature, AgentClassification, AgentCategory } from "../types/agent.js";
import { aiSignatures, microsoftFirstPartyAppIds } from "../config/aiSignatures.js";

interface ClassifiedApp {
  servicePrincipal: GraphServicePrincipal;
  classification: AgentClassification | null;
  category: AgentCategory;
  vendor: string;
  isAiTool: boolean;
}

function matchesSignature(
  sp: GraphServicePrincipal,
  signature: AiSignature
): { matched: boolean; fields: string[]; confidence: number } {
  const matchedFields: string[] = [];

  // Check known app IDs first (highest confidence)
  if (signature.knownAppIds?.includes(sp.appId)) {
    return { matched: true, fields: ["appId"], confidence: 1.0 };
  }

  // Check each match pattern
  for (const pattern of signature.matchPatterns) {
    const fieldValue = sp[pattern.field as keyof GraphServicePrincipal];
    if (typeof fieldValue !== "string") continue;

    const regex = new RegExp(pattern.pattern, "i");
    if (regex.test(fieldValue)) {
      matchedFields.push(pattern.field);
    }
  }

  if (matchedFields.length === 0) {
    return { matched: false, fields: [], confidence: 0 };
  }

  // Confidence based on number of matched fields
  const confidence = Math.min(0.5 + matchedFields.length * 0.2, 1.0);
  return { matched: true, fields: matchedFields, confidence };
}

export function classifyServicePrincipals(
  servicePrincipals: GraphServicePrincipal[]
): ClassifiedApp[] {
  const results: ClassifiedApp[] = [];

  for (const sp of servicePrincipals) {
    // Skip Microsoft first-party apps
    if (microsoftFirstPartyAppIds.has(sp.appId)) continue;

    let bestMatch: {
      signature: AiSignature;
      fields: string[];
      confidence: number;
    } | null = null;

    for (const signature of aiSignatures) {
      const result = matchesSignature(sp, signature);
      if (result.matched) {
        if (!bestMatch || result.confidence > bestMatch.confidence) {
          bestMatch = {
            signature,
            fields: result.fields,
            confidence: result.confidence,
          };
        }
      }
    }

    if (bestMatch) {
      results.push({
        servicePrincipal: sp,
        classification: {
          signatureId: bestMatch.signature.id,
          signatureName: bestMatch.signature.name,
          confidence: bestMatch.confidence,
          matchedFields: bestMatch.fields,
        },
        category: bestMatch.signature.category,
        vendor: bestMatch.signature.vendor,
        isAiTool: true,
      });
    }
  }

  return results;
}

export function getSignatureById(id: string): AiSignature | undefined {
  return aiSignatures.find((s) => s.id === id);
}
