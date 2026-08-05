// Seed default model routing rules on server startup.
// Uses insertMany with ordered:false — duplicates (by name) are silently skipped.
// These rules auto-optimize cost by routing non-complex prompts to cheaper models.

import crypto from 'node:crypto';

const DEFAULT_RULES = [
  {
    name: 'Auto-optimize: Anthropic non-complex → Sonnet',
    enabled: true,
    priority: 10,
    conditions: { complexity: ['simple', 'moderate'], provider: ['anthropic'] },
    action: { model: 'claude-sonnet-4-20250514' },
  },
  {
    name: 'Auto-optimize: OpenAI non-complex → GPT-4o-mini',
    enabled: true,
    priority: 10,
    conditions: { complexity: ['simple', 'moderate'], provider: ['openai'] },
    action: { model: 'gpt-4o-mini' },
  },
  {
    name: 'Auto-optimize: Google non-complex → Gemini Flash',
    enabled: true,
    priority: 10,
    conditions: { complexity: ['simple', 'moderate'], provider: ['google'] },
    action: { model: 'gemini-2.0-flash' },
  },
];

export async function seedDefaultRoutingRules(db) {
  const col = db.collection('routing_rules');
  for (const rule of DEFAULT_RULES) {
    const existing = await col.findOne({ name: rule.name });
    if (existing) continue;
    await col.insertOne({
      ...rule,
      id: crypto.randomUUID(),
      created_at: new Date(),
      updated_at: new Date(),
    });
    console.log(`[seed] routing rule: ${rule.name}`);
  }
}
