// Seed ai_platforms with the existing hardcoded sources so the dashboard
// starts populated. Idempotent — uses ON CONFLICT DO NOTHING so admin edits
// in the dashboard are never overwritten by a re-run.
//
// Sources merged:
//   1. agent/src/registry/ai-apps.json        — code-reviewed registry
//   2. The KNOWN_SAAS_WITH_AI list             — hardcoded in fingerprint.js
//   3. The hardcoded content_scripts.matches   — from the extension manifest

import Database from 'better-sqlite3';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'governance.db');

const db = new Database(DB_PATH);

// Source 1: agent/src/registry/ai-apps.json
const appsJsonPath = path.resolve(__dirname, '..', '..', 'agent', 'src', 'registry', 'ai-apps.json');
const reg = JSON.parse(await readFile(appsJsonPath, 'utf8'));

// Source 2: SaaS-with-AI allowlist (copy of fingerprint.js's KNOWN_SAAS_WITH_AI)
const KNOWN_SAAS = [
  { host: 'office.com',            vendor: 'Microsoft',  product: 'Microsoft 365 Copilot', category: 'ide-assistant', sandbox: 'remote' },
  { host: 'office365.com',         vendor: 'Microsoft',  product: 'Microsoft 365 Copilot', category: 'ide-assistant', sandbox: 'remote' },
  { host: 'outlook.office.com',    vendor: 'Microsoft',  product: 'Outlook Copilot',       category: 'chat-frontend', sandbox: 'remote' },
  { host: 'outlook.office365.com', vendor: 'Microsoft',  product: 'Outlook Copilot',       category: 'chat-frontend', sandbox: 'remote' },
  { host: 'outlook.live.com',      vendor: 'Microsoft',  product: 'Outlook Copilot',       category: 'chat-frontend', sandbox: 'remote' },
  { host: 'sharepoint.com',        vendor: 'Microsoft',  product: 'SharePoint Copilot',    category: 'ide-assistant', sandbox: 'remote' },
  { host: 'teams.microsoft.com',   vendor: 'Microsoft',  product: 'Teams Copilot',         category: 'chat-frontend', sandbox: 'remote' },
  { host: 'mail.google.com',       vendor: 'Google',     product: 'Gemini in Gmail',       category: 'chat-frontend', sandbox: 'remote' },
  { host: 'docs.google.com',       vendor: 'Google',     product: 'Gemini in Docs',        category: 'ide-assistant', sandbox: 'remote' },
  { host: 'meet.google.com',       vendor: 'Google',     product: 'Gemini in Meet',        category: 'chat-frontend', sandbox: 'remote' },
  { host: 'slack.com',             vendor: 'Slack',      product: 'Slack AI',              category: 'chat-frontend', sandbox: 'remote' },
  { host: 'notion.so',             vendor: 'Notion',     product: 'Notion AI',             category: 'ide-assistant', sandbox: 'remote' },
  { host: 'notion.site',           vendor: 'Notion',     product: 'Notion AI',             category: 'ide-assistant', sandbox: 'remote' },
  { host: 'linear.app',            vendor: 'Linear',     product: 'Linear AI',             category: 'ide-assistant', sandbox: 'remote' },
  { host: 'atlassian.net',         vendor: 'Atlassian',  product: 'Atlassian Intelligence', category: 'ide-assistant', sandbox: 'remote' },
  { host: 'atlassian.com',         vendor: 'Atlassian',  product: 'Atlassian Intelligence', category: 'ide-assistant', sandbox: 'remote' },
  { host: 'asana.com',             vendor: 'Asana',      product: 'Asana AI',              category: 'ide-assistant', sandbox: 'remote' },
  { host: 'monday.com',            vendor: 'monday.com', product: 'monday AI',             category: 'ide-assistant', sandbox: 'remote' },
  { host: 'clickup.com',           vendor: 'ClickUp',    product: 'ClickUp Brain',         category: 'ide-assistant', sandbox: 'remote' },
  { host: 'app.clickup.com',       vendor: 'ClickUp',    product: 'ClickUp Brain',         category: 'ide-assistant', sandbox: 'remote' },
  { host: 'canva.com',             vendor: 'Canva',      product: 'Magic Studio',          category: 'ide-assistant', sandbox: 'remote' },
  { host: 'figma.com',             vendor: 'Figma',      product: 'Figma AI',              category: 'ide-assistant', sandbox: 'remote' },
  { host: 'miro.com',              vendor: 'Miro',       product: 'Miro AI',               category: 'ide-assistant', sandbox: 'remote' },
  { host: 'github.com',            vendor: 'GitHub',     product: 'GitHub Copilot Chat',   category: 'ide-assistant', sandbox: 'remote' },
  { host: 'gitlab.com',            vendor: 'GitLab',     product: 'GitLab Duo',            category: 'ide-assistant', sandbox: 'remote' },
  { host: 'lightning.force.com',   vendor: 'Salesforce', product: 'Einstein / Agentforce', category: 'ide-assistant', sandbox: 'remote' },
  { host: 'salesforce.com',        vendor: 'Salesforce', product: 'Einstein / Agentforce', category: 'ide-assistant', sandbox: 'remote' },
  { host: 'hubspot.com',           vendor: 'HubSpot',    product: 'HubSpot AI',            category: 'ide-assistant', sandbox: 'remote' },
];

const insert = db.prepare(`
  INSERT INTO ai_platforms
    (host, vendor, product, category, sandbox, governed, surface, capture_mode, governance_note, pinned, source, added_by)
  VALUES (?, ?, ?, ?, ?, 1, ?, 'observe', ?, ?, ?, 'system')
  ON CONFLICT(host) DO NOTHING
`);

let inserted = 0, skipped = 0;

function tryInsert(row, source) {
  const r = insert.run(
    row.host.toLowerCase(),
    row.vendor || null,
    row.product || row.vendor || row.host,
    row.category || null,
    row.sandbox || 'unknown',
    row.surface || 'browser',
    row.governance_note || null,
    row.pinned ? 1 : 0,
    source,
  );
  if (r.changes) inserted++; else skipped++;
}

console.log('Seeding ai_platforms from ai-apps.json …');
for (const app of reg.apps || []) {
  for (const d of (app.apiDomains || []).concat(app.webDomains || [])) {
    tryInsert({
      host: d,
      vendor: app.vendor || app.name,
      product: app.name,
      category: app.category,
      sandbox: app.sandbox,
      governance_note: app.governanceNote || null,
      pinned: !!app.pinned,
      surface: 'all',
    }, 'seed:registry');
  }
}

console.log('Seeding ai_platforms from SaaS-with-AI allowlist …');
for (const e of KNOWN_SAAS) tryInsert({ ...e, surface: 'browser' }, 'seed:allowlist');

console.log(`\nInserted: ${inserted}   skipped (already present): ${skipped}`);
const total = db.prepare('SELECT COUNT(*) AS c, SUM(governed) AS g FROM ai_platforms').get();
console.log(`Total rows in ai_platforms: ${total.c}   governed: ${total.g}`);
db.close();
