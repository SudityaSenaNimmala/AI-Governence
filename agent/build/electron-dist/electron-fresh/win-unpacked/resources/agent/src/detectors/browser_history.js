import { join } from 'node:path';
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { exists, safeReaddir } from '../util/fs.js';

export const name = 'browser_history';
export const description = 'Detect AI service usage via browser history (domains only, no URLs or content)';
export const platforms = ['win32', 'darwin', 'linux'];

// Catalog of AI service domains. Only domains matching one of these patterns
// are extracted; everything else from the user's history is discarded inside
// this function and never leaves it.
const AI_DOMAINS = [
  { domain: 'chatgpt.com', product: 'ChatGPT', vendor: 'OpenAI' },
  { domain: 'chat.openai.com', product: 'ChatGPT (legacy)', vendor: 'OpenAI' },
  { domain: 'claude.ai', product: 'Claude', vendor: 'Anthropic' },
  { domain: 'gemini.google.com', product: 'Gemini', vendor: 'Google' },
  { domain: 'bard.google.com', product: 'Bard (legacy)', vendor: 'Google' },
  { domain: 'aistudio.google.com', product: 'Google AI Studio', vendor: 'Google' },
  { domain: 'notebooklm.google.com', product: 'NotebookLM', vendor: 'Google' },
  { domain: 'perplexity.ai', product: 'Perplexity', vendor: 'Perplexity' },
  { domain: 'copilot.microsoft.com', product: 'Microsoft Copilot', vendor: 'Microsoft' },
  { domain: 'github.com/copilot', product: 'GitHub Copilot Chat', vendor: 'GitHub' },
  { domain: 'poe.com', product: 'Poe', vendor: 'Quora' },
  { domain: 'you.com', product: 'You.com', vendor: 'You' },
  { domain: 'character.ai', product: 'Character.AI', vendor: 'Character.AI' },
  { domain: 'huggingface.co', product: 'HuggingFace', vendor: 'HuggingFace' },
  { domain: 'mistral.ai', product: 'Mistral', vendor: 'Mistral' },
  { domain: 'chat.mistral.ai', product: 'Le Chat', vendor: 'Mistral' },
  { domain: 'groq.com', product: 'Groq', vendor: 'Groq' },
  { domain: 'cohere.com', product: 'Cohere', vendor: 'Cohere' },
  { domain: 'replicate.com', product: 'Replicate', vendor: 'Replicate' },
  { domain: 'console.anthropic.com', product: 'Anthropic Console', vendor: 'Anthropic' },
  { domain: 'platform.openai.com', product: 'OpenAI Platform', vendor: 'OpenAI' },
  { domain: 'console.groq.com', product: 'Groq Console', vendor: 'Groq' },
  { domain: 'kagi.com', product: 'Kagi Assistant', vendor: 'Kagi' },
  { domain: 'cursor.com', product: 'Cursor', vendor: 'Anysphere' },
  { domain: 'v0.dev', product: 'v0', vendor: 'Vercel' },
  { domain: 'bolt.new', product: 'Bolt', vendor: 'StackBlitz' },
  { domain: 'lovable.dev', product: 'Lovable', vendor: 'Lovable' },
  { domain: 'replit.com', product: 'Replit Agent', vendor: 'Replit' },
];

const AI_DOMAIN_SET = new Set(AI_DOMAINS.map((d) => d.domain));

function classify(host) {
  if (!host) return null;
  const h = host.toLowerCase().replace(/^www\./, '');
  if (AI_DOMAIN_SET.has(h)) return AI_DOMAINS.find((d) => d.domain === h);
  // suffix-match for subdomains
  for (const d of AI_DOMAINS) {
    if (h === d.domain || h.endsWith('.' + d.domain)) return d;
  }
  return null;
}

export async function detect(ctx) {
  const findings = [];
  const errors = [];
  let itemsScanned = 0;

  const chromiumBrowsers = [
    { name: 'chrome', dir: ctx.paths.browserData.chrome },
    { name: 'edge', dir: ctx.paths.browserData.edge },
    { name: 'brave', dir: ctx.paths.browserData.brave },
  ];

  for (const b of chromiumBrowsers) {
    try {
      const r = await scanChromium(b.name, b.dir, ctx.log);
      itemsScanned += r.scanned;
      for (const f of r.findings) findings.push(f);
    } catch (err) {
      errors.push({ message: `${b.name}: ${err.message}`, recoverable: true });
    }
  }

  try {
    const r = await scanFirefox(ctx.paths.browserData.firefox, ctx.log);
    itemsScanned += r.scanned;
    for (const f of r.findings) findings.push(f);
  } catch (err) {
    errors.push({ message: `firefox: ${err.message}`, recoverable: true });
  }

  return { findings, errors, stats: { itemsScanned } };
}

async function scanChromium(browserName, baseDir, log) {
  if (!baseDir || !(await exists(baseDir))) return { findings: [], scanned: 0 };

  let Database;
  try {
    ({ default: Database } = await import('better-sqlite3'));
  } catch (err) {
    throw new Error('better-sqlite3 not installed; run `npm install` in agent/');
  }

  // Find profile directories. Chromium uses 'Default', 'Profile 1', 'Profile 2', ...
  const entries = await safeReaddir(baseDir);
  const profiles = entries
    .filter((e) => e.isDirectory() && (e.name === 'Default' || /^Profile \d+$/.test(e.name)))
    .map((e) => e.name);

  const aggregated = new Map(); // key: profile|domain  -> {visits, lastVisit}
  let totalScanned = 0;

  for (const profile of profiles) {
    const historyPath = join(baseDir, profile, 'History');
    if (!(await exists(historyPath))) continue;

    // Copy to temp so we don't lock the browser's DB
    const tmp = await mkdtemp(join(tmpdir(), 'aigov-hist-'));
    const copy = join(tmp, 'History');
    try {
      await copyFile(historyPath, copy);
      const db = new Database(copy, { readonly: true, fileMustExist: true });
      const rows = db.prepare(
        // Chrome stores last_visit_time as microseconds since 1601-01-01.
        // We convert to milliseconds-since-epoch in SQL.
        `SELECT url, visit_count, (last_visit_time / 1000 - 11644473600000) AS last_visit_ms
         FROM urls
         WHERE visit_count > 0
         ORDER BY last_visit_time DESC
         LIMIT 50000`
      ).all();
      db.close();
      totalScanned += rows.length;

      for (const row of rows) {
        let host;
        try { host = new URL(row.url).hostname; } catch { continue; }
        const match = classify(host);
        if (!match) continue;
        const key = `${profile}|${match.domain}`;
        const existing = aggregated.get(key);
        if (existing) {
          existing.visits += row.visit_count;
          existing.lastVisit = Math.max(existing.lastVisit, row.last_visit_ms || 0);
        } else {
          aggregated.set(key, {
            browser: browserName,
            profile,
            domain: match.domain,
            product: match.product,
            vendor: match.vendor,
            visits: row.visit_count,
            lastVisit: row.last_visit_ms || 0,
          });
        }
      }
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  }

  const findings = [];
  for (const v of aggregated.values()) {
    findings.push({
      type: 'browser_ai_visit',
      browser: v.browser,
      profile: v.profile,
      domain: v.domain,
      product: v.product,
      vendor: v.vendor,
      visitCount: v.visits,
      lastVisit: v.lastVisit ? new Date(v.lastVisit).toISOString() : null,
    });
  }
  return { findings, scanned: totalScanned };
}

async function scanFirefox(profilesDir, log) {
  if (!profilesDir || !(await exists(profilesDir))) return { findings: [], scanned: 0 };

  let Database;
  try {
    ({ default: Database } = await import('better-sqlite3'));
  } catch {
    throw new Error('better-sqlite3 not installed');
  }

  const entries = await safeReaddir(profilesDir);
  const profileDirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);

  const findings = [];
  let scanned = 0;

  for (const profile of profileDirs) {
    const placesPath = join(profilesDir, profile, 'places.sqlite');
    if (!(await exists(placesPath))) continue;

    const tmp = await mkdtemp(join(tmpdir(), 'aigov-ff-'));
    const copy = join(tmp, 'places.sqlite');
    try {
      await copyFile(placesPath, copy);
      const db = new Database(copy, { readonly: true, fileMustExist: true });
      const rows = db.prepare(
        // Firefox last_visit_date is microseconds since epoch
        `SELECT url, visit_count, (last_visit_date / 1000) AS last_visit_ms
         FROM moz_places
         WHERE visit_count > 0
         LIMIT 50000`
      ).all();
      db.close();
      scanned += rows.length;

      const aggregated = new Map();
      for (const row of rows) {
        let host;
        try { host = new URL(row.url).hostname; } catch { continue; }
        const match = classify(host);
        if (!match) continue;
        const existing = aggregated.get(match.domain);
        if (existing) {
          existing.visits += row.visit_count;
          existing.lastVisit = Math.max(existing.lastVisit, row.last_visit_ms || 0);
        } else {
          aggregated.set(match.domain, {
            domain: match.domain, product: match.product, vendor: match.vendor,
            visits: row.visit_count, lastVisit: row.last_visit_ms || 0,
          });
        }
      }
      for (const v of aggregated.values()) {
        findings.push({
          type: 'browser_ai_visit',
          browser: 'firefox',
          profile,
          domain: v.domain,
          product: v.product,
          vendor: v.vendor,
          visitCount: v.visits,
          lastVisit: v.lastVisit ? new Date(v.lastVisit).toISOString() : null,
        });
      }
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  }

  return { findings, scanned };
}
