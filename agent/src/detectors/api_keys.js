import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { safeReadText, exists } from '../util/fs.js';

export const name = 'api_keys';
export const description = 'Detect presence of AI provider API keys (fingerprint only — never the key value)';
export const platforms = ['win32', 'darwin', 'linux'];

// Patterns matching API keys for AI providers. The capture group is the key value
// which we ONLY use to compute a short fingerprint — never stored, never sent.
const KEY_PATTERNS = [
  { provider: 'openai', regex: /\b(sk-(?:proj-)?[A-Za-z0-9_-]{20,})\b/g },
  { provider: 'anthropic', regex: /\b(sk-ant-(?:api\d{2}-)?[A-Za-z0-9_-]{20,})\b/g },
  { provider: 'google-genai', regex: /\b(AIza[0-9A-Za-z_-]{30,})\b/g },
  { provider: 'cohere', regex: /\b(co_[A-Za-z0-9]{30,})\b/g },
  { provider: 'huggingface', regex: /\b(hf_[A-Za-z0-9]{30,})\b/g },
  { provider: 'perplexity', regex: /\b(pplx-[A-Za-z0-9]{30,})\b/g },
  { provider: 'mistral', regex: /\b([A-Za-z0-9]{32})\b(?=.*MISTRAL)/g }, // looser, requires context
  { provider: 'groq', regex: /\b(gsk_[A-Za-z0-9]{30,})\b/g },
  { provider: 'replicate', regex: /\b(r8_[A-Za-z0-9]{30,})\b/g },
];

const ENV_VAR_HINTS = [
  { provider: 'openai', name: 'OPENAI_API_KEY' },
  { provider: 'anthropic', name: 'ANTHROPIC_API_KEY' },
  { provider: 'google-genai', name: 'GOOGLE_API_KEY' },
  { provider: 'google-genai', name: 'GEMINI_API_KEY' },
  { provider: 'cohere', name: 'COHERE_API_KEY' },
  { provider: 'huggingface', name: 'HF_TOKEN' },
  { provider: 'huggingface', name: 'HUGGINGFACE_API_KEY' },
  { provider: 'perplexity', name: 'PERPLEXITY_API_KEY' },
  { provider: 'mistral', name: 'MISTRAL_API_KEY' },
  { provider: 'groq', name: 'GROQ_API_KEY' },
  { provider: 'replicate', name: 'REPLICATE_API_TOKEN' },
  { provider: 'azure-openai', name: 'AZURE_OPENAI_API_KEY' },
];

export async function detect(ctx) {
  const findings = [];
  const errors = [];
  let itemsScanned = 0;

  // 1. Shell profiles and dotfiles (likely places for env-var exports)
  const shellFiles = [
    '.zshrc', '.bashrc', '.bash_profile', '.profile', '.zprofile',
    '.config/fish/config.fish', '.zshenv',
  ].map((p) => join(ctx.paths.home, ...p.split('/')));

  // 2. Common .env locations
  const envCandidates = [
    join(ctx.paths.home, '.env'),
    join(ctx.paths.home, '.openai'),
    join(ctx.paths.home, '.anthropic'),
  ];

  // 3. .env files in well-known dev folders (one level deep only)
  const desktops = ctx.paths.desktopCandidates || [join(ctx.paths.home, 'Desktop')];
  const documents = ctx.paths.documentsCandidates || [join(ctx.paths.home, 'Documents')];
  const devFolders = [
    join(ctx.paths.home, 'projects'),
    join(ctx.paths.home, 'code'),
    join(ctx.paths.home, 'dev'),
    join(ctx.paths.home, 'work'),
    join(ctx.paths.home, 'source', 'repos'),
    ...desktops,
    ...documents,
    ...documents.map((d) => join(d, 'GitHub')),
    ...documents.map((d) => join(d, 'projects')),
    ...(ctx.paths.extraDevRoots || []),
  ];

  const filesToCheck = [...shellFiles, ...envCandidates];
  for (const folder of devFolders) {
    const sub = await listFirstLevelDotenvs(folder);
    filesToCheck.push(...sub);
  }

  for (const file of filesToCheck) {
    if (!(await exists(file))) continue;
    itemsScanned++;
    const text = await safeReadText(file, 256 * 1024);
    if (!text) continue;

    for (const { provider, regex } of KEY_PATTERNS) {
      regex.lastIndex = 0;
      let m;
      while ((m = regex.exec(text)) !== null) {
        findings.push({
          type: 'api_key',
          provider,
          location: file,
          fingerprint: fingerprintKey(m[1]),
          length: m[1].length,
        });
      }
    }

    // Env-var name hint, even when value isn't matched by a strict pattern
    for (const { provider, name: varName } of ENV_VAR_HINTS) {
      const r = new RegExp(`(?:^|\\n|export\\s+)${varName}\\s*=\\s*(["']?)([^\\s"'#]+)\\1`, 'g');
      let m;
      while ((m = r.exec(text)) !== null) {
        // Avoid duplicating a finding the strict pattern already caught
        if (findings.some((f) => f.location === file && f.fingerprint === fingerprintKey(m[2]))) continue;
        findings.push({
          type: 'api_key',
          provider,
          location: file,
          envVar: varName,
          fingerprint: fingerprintKey(m[2]),
          length: m[2].length,
          inferred: true,
        });
      }
    }
  }

  return { findings, errors, stats: { itemsScanned } };
}

async function listFirstLevelDotenvs(folder) {
  if (!(await exists(folder))) return [];
  const { readdir } = await import('node:fs/promises');
  let entries;
  try { entries = await readdir(folder, { withFileTypes: true }); } catch { return []; }
  const out = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const candidate = join(folder, e.name, '.env');
    if (await exists(candidate)) out.push(candidate);
    const candidateLocal = join(folder, e.name, '.env.local');
    if (await exists(candidateLocal)) out.push(candidateLocal);
  }
  return out;
}

// First 6 chars + SHA-256 over the whole key, truncated. Cannot be reversed.
function fingerprintKey(value) {
  const prefix = value.slice(0, 6);
  const hash = createHash('sha256').update(value).digest('hex').slice(0, 12);
  return `${prefix}...${hash}`;
}
