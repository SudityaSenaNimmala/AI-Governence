// Seed ai_platforms from the static agent registry (agent/src/registry/ai-apps.json).
// Called once at server startup after schema migrations.
// Uses MongoDB insertMany with ordered:false so duplicates are silently ignored
// (unique index on host).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REGISTRY_PATH = resolve(__dirname, '../../agent/src/registry/ai-apps.json');

export async function seedAiPlatforms(db) {
  let raw;
  try {
    raw = JSON.parse(readFileSync(REGISTRY_PATH, 'utf8'));
  } catch (e) {
    console.warn('[seed] could not load ai-apps.json:', e.message);
    return;
  }

  const apps = Array.isArray(raw.apps) ? raw.apps : [];
  const now = new Date();
  const docs = [];

  for (const app of apps) {
    const domains = [
      ...(app.apiDomains || []).map((d) => ({ host: d, surface: 'all' })),
      ...(app.webDomains  || []).map((d) => ({ host: d, surface: 'browser' })),
    ];

    for (const { host, surface } of domains) {
      if (!host) continue;
      const h = host.toLowerCase();

      // Skip local-only entries.
      if (h === 'localhost' || h.startsWith('127.') || h === '0.0.0.0') continue;

      docs.push({
        host: h,
        vendor: app.vendor        || null,
        product: app.name          || null,
        category: app.category      || null,
        sandbox: app.sandbox       || 'unknown',
        governed: 1,
        surface,
        governance_note: app.governanceNote || null,
        pinned: app.pinned ? 1 : 0,
        source: 'seed',
        added_by: 'system',
        added_at: now,
        updated_at: now,
      });
    }
  }

  if (docs.length > 0) {
    try {
      const result = await db.collection('ai_platforms').insertMany(docs, { ordered: false });
      if (result.insertedCount > 0) {
        console.log(`[seed] seeded ${result.insertedCount} AI platform host entries from ai-apps.json`);
      }
    } catch (e) {
      // With ordered:false, MongoDB throws a BulkWriteError but still inserts
      // non-duplicate docs. Extract the actual inserted count.
      if (e.code === 11000 || e.insertedCount != null) {
        const inserted = e.insertedCount ?? 0;
        if (inserted > 0) {
          console.log(`[seed] seeded ${inserted} AI platform host entries from ai-apps.json`);
        }
      } else {
        throw e;
      }
    }
  }

  // ── Browser-only AI platforms not covered by ai-apps.json ────────────────
  const BROWSER_PLATFORMS = [
    // AI coding / app builders
    { host: 'bolt.new',              vendor: 'StackBlitz',  product: 'Bolt',                category: 'autonomous-agent', sandbox: 'remote' },
    { host: 'stackblitz.com',        vendor: 'StackBlitz',  product: 'Bolt',                category: 'autonomous-agent', sandbox: 'remote' },
    { host: 'lovable.dev',           vendor: 'Lovable',     product: 'Lovable',             category: 'autonomous-agent', sandbox: 'remote' },
    { host: 'v0.dev',                vendor: 'Vercel',      product: 'v0',                  category: 'autonomous-agent', sandbox: 'remote' },
    { host: 'cursor.sh',             vendor: 'Cursor',      product: 'Cursor',              category: 'ide-assistant',    sandbox: 'local'  },
    { host: 'replit.com',            vendor: 'Replit',      product: 'Replit Agent',        category: 'autonomous-agent', sandbox: 'remote' },
    { host: 'idx.dev',               vendor: 'Google',      product: 'Project IDX',         category: 'ide-assistant',    sandbox: 'remote' },
    { host: 'github.dev',            vendor: 'GitHub',      product: 'GitHub Copilot',      category: 'ide-assistant',    sandbox: 'remote' },
    { host: 'github.com',            vendor: 'GitHub',      product: 'GitHub Copilot',      category: 'ide-assistant',    sandbox: 'remote' },
    // AI chat / search
    { host: 'you.com',               vendor: 'You.com',     product: 'You.com AI',          category: 'chat-frontend',    sandbox: 'remote' },
    { host: 'chat.deepseek.com',     vendor: 'DeepSeek',    product: 'DeepSeek Chat',       category: 'chat-frontend',    sandbox: 'remote' },
    { host: 'deepseek.com',          vendor: 'DeepSeek',    product: 'DeepSeek',            category: 'api-platform',     sandbox: 'remote' },
    { host: 'grok.com',              vendor: 'xAI',         product: 'Grok',                category: 'chat-frontend',    sandbox: 'remote' },
    { host: 'x.ai',                  vendor: 'xAI',         product: 'Grok',                category: 'api-platform',     sandbox: 'remote' },
    { host: 'character.ai',          vendor: 'Character.AI',product: 'Character.AI',        category: 'chat-frontend',    sandbox: 'remote' },
    { host: 'coral.cohere.com',      vendor: 'Cohere',      product: 'Coral',               category: 'chat-frontend',    sandbox: 'remote' },
    { host: 'cohere.com',            vendor: 'Cohere',      product: 'Cohere',              category: 'api-platform',     sandbox: 'remote' },
    { host: 'openrouter.ai',         vendor: 'OpenRouter',  product: 'OpenRouter',          category: 'api-platform',     sandbox: 'remote' },
    { host: 'lmarena.ai',            vendor: 'LMSYS',       product: 'LM Arena',            category: 'chat-frontend',    sandbox: 'remote' },
    { host: 'chat.lmsys.org',        vendor: 'LMSYS',       product: 'Chatbot Arena',       category: 'chat-frontend',    sandbox: 'remote' },
    { host: 'together.ai',           vendor: 'Together AI', product: 'Together AI',         category: 'api-platform',     sandbox: 'remote' },
    { host: 'fireworks.ai',          vendor: 'Fireworks',   product: 'Fireworks AI',        category: 'api-platform',     sandbox: 'remote' },
    { host: 'replicate.com',         vendor: 'Replicate',   product: 'Replicate',           category: 'api-platform',     sandbox: 'remote' },
    // AI writing / productivity
    { host: 'jasper.ai',             vendor: 'Jasper',      product: 'Jasper AI',           category: 'ide-assistant',    sandbox: 'remote' },
    { host: 'copy.ai',               vendor: 'Copy.ai',     product: 'Copy.ai',             category: 'ide-assistant',    sandbox: 'remote' },
    { host: 'writesonic.com',        vendor: 'Writesonic',  product: 'Writesonic',          category: 'ide-assistant',    sandbox: 'remote' },
    { host: 'gamma.app',             vendor: 'Gamma',       product: 'Gamma',               category: 'ide-assistant',    sandbox: 'remote' },
    { host: 'notion.so',             vendor: 'Notion',      product: 'Notion AI',           category: 'ide-assistant',    sandbox: 'remote' },
    { host: 'notion.site',           vendor: 'Notion',      product: 'Notion AI',           category: 'ide-assistant',    sandbox: 'remote' },
    // AI media / image / audio
    { host: 'suno.com',              vendor: 'Suno',        product: 'Suno',                category: 'chat-frontend',    sandbox: 'remote' },
    { host: 'udio.com',              vendor: 'Udio',        product: 'Udio',                category: 'chat-frontend',    sandbox: 'remote' },
    { host: 'app.runwayml.com',      vendor: 'Runway',      product: 'Runway',              category: 'autonomous-agent', sandbox: 'remote' },
    { host: 'runwayml.com',          vendor: 'Runway',      product: 'Runway',              category: 'autonomous-agent', sandbox: 'remote' },
    { host: 'midjourney.com',        vendor: 'Midjourney',  product: 'Midjourney',          category: 'chat-frontend',    sandbox: 'remote' },
    { host: 'elevenlabs.io',         vendor: 'ElevenLabs',  product: 'ElevenLabs',          category: 'api-platform',     sandbox: 'remote' },
    // Productivity SaaS with embedded AI
    { host: 'slack.com',             vendor: 'Slack',       product: 'Slack AI',            category: 'chat-frontend',    sandbox: 'remote' },
    { host: 'linear.app',            vendor: 'Linear',      product: 'Linear AI',           category: 'ide-assistant',    sandbox: 'remote' },
    { host: 'asana.com',             vendor: 'Asana',       product: 'Asana AI',            category: 'ide-assistant',    sandbox: 'remote' },
    { host: 'monday.com',            vendor: 'monday.com',  product: 'monday AI',           category: 'ide-assistant',    sandbox: 'remote' },
    { host: 'clickup.com',           vendor: 'ClickUp',     product: 'ClickUp Brain',       category: 'ide-assistant',    sandbox: 'remote' },
    { host: 'canva.com',             vendor: 'Canva',       product: 'Magic Studio',        category: 'ide-assistant',    sandbox: 'remote' },
    { host: 'figma.com',             vendor: 'Figma',       product: 'Figma AI',            category: 'ide-assistant',    sandbox: 'remote' },
    { host: 'miro.com',              vendor: 'Miro',        product: 'Miro AI',             category: 'ide-assistant',    sandbox: 'remote' },
    { host: 'gitlab.com',            vendor: 'GitLab',      product: 'GitLab Duo',          category: 'ide-assistant',    sandbox: 'remote' },
    // Microsoft 365
    { host: 'office.com',            vendor: 'Microsoft',   product: 'Microsoft 365 Copilot', category: 'ide-assistant', sandbox: 'remote' },
    { host: 'outlook.office.com',    vendor: 'Microsoft',   product: 'Outlook Copilot',     category: 'chat-frontend',    sandbox: 'remote' },
    { host: 'outlook.office365.com', vendor: 'Microsoft',   product: 'Outlook Copilot',     category: 'chat-frontend',    sandbox: 'remote' },
    { host: 'teams.microsoft.com',   vendor: 'Microsoft',   product: 'Teams Copilot',       category: 'chat-frontend',    sandbox: 'remote' },
    { host: 'sharepoint.com',        vendor: 'Microsoft',   product: 'SharePoint Copilot',  category: 'ide-assistant',    sandbox: 'remote' },
    // Google Workspace
    { host: 'mail.google.com',       vendor: 'Google',      product: 'Gemini in Gmail',     category: 'chat-frontend',    sandbox: 'remote' },
    { host: 'docs.google.com',       vendor: 'Google',      product: 'Gemini in Docs',      category: 'ide-assistant',    sandbox: 'remote' },
    { host: 'meet.google.com',       vendor: 'Google',      product: 'Gemini in Meet',      category: 'chat-frontend',    sandbox: 'remote' },
  ];

  const browserDocs = BROWSER_PLATFORMS.map((p) => ({
    host: p.host,
    vendor: p.vendor,
    product: p.product,
    category: p.category,
    sandbox: p.sandbox,
    governed: 1,
    surface: 'browser',
    source: 'seed',
    added_by: 'system',
    added_at: now,
    updated_at: now,
  }));

  if (browserDocs.length > 0) {
    try {
      const result = await db.collection('ai_platforms').insertMany(browserDocs, { ordered: false });
      if (result.insertedCount > 0) {
        console.log(`[seed] seeded ${result.insertedCount} browser-only AI platform entries`);
      }
    } catch (e) {
      if (e.code === 11000 || e.insertedCount != null) {
        const inserted = e.insertedCount ?? 0;
        if (inserted > 0) {
          console.log(`[seed] seeded ${inserted} browser-only AI platform entries`);
        }
      } else {
        throw e;
      }
    }
  }
}
