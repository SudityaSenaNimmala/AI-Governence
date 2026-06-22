import { join } from 'node:path';
import { safeReaddir, safeReadJson, safeReadText, safeStat, exists } from '../util/fs.js';

export const name = 'agent_projects';
export const description = 'Find local folders that appear to be AI / agent projects (LangChain, AutoGen, OpenAI SDK, Anthropic SDK, etc.)';
export const platforms = ['win32', 'darwin', 'linux'];

// Limit per session — we never walk the whole disk, only well-known dev folders.
const MAX_PROJECTS_PER_ROOT = 200;
// Allow a deeper walk so we can find AI signals inside repos (e.g.
// `Downloads/<repo>/backend`) but we still collapse to the top-level folder.
const MAX_DEPTH = 4;

// Folder names that are NEVER the "main project" — they're conventional
// sub-folders inside a real project. When we detect AI signals inside one
// of these, we attribute the project to the parent folder instead.
const PASSTHROUGH_NAMES = new Set([
  'backend', 'frontend', 'client', 'server', 'api', 'app',
  'src', 'lib', 'core', 'packages', 'apps', 'services',
  'web', 'webapp', 'web-app', 'mobile', 'admin',
  'project', 'project.webapp',
]);

// Frameworks that indicate an autonomous AI agent (multi-step reasoning,
// tool use, agent orchestration) — distinct from just "calls an LLM".
const AGENT_FRAMEWORKS = new Set([
  '@langchain/core', '@langchain/openai', '@langchain/anthropic', 'langchain',
  'langchain-core', 'langchain-community', 'langgraph',
  'llamaindex', 'llama-index',
  'autogen', 'autogen-agentchat', 'pyautogen', 'autogen-core',
  'crewai',
  'haystack-ai',
  '@modelcontextprotocol/sdk', 'mcp', 'modelcontextprotocol',
  '@openai/agents',
  'instructor', 'guidance',
]);

// Decide which bucket a project belongs in based on its detected frameworks.
//   - ai_coding_agent: project is managed by an IDE agent (Claude Code, Cursor,
//                      Aider) — has .claude / .cursor / CLAUDE.md / .cursorrules
//   - ai_agent:        autonomous agent framework (LangChain, AutoGen, CrewAI…)
//   - ai_app:          just calls LLM APIs (openai, anthropic, Vercel ai SDK…)
// A project can match more than one; we return all that apply plus a primary.
export function categorizeProject(frameworks) {
  const hasCodingAgentMarker = frameworks.some((f) => typeof f === 'string' && f.startsWith('(local-config:'));
  const hasAgentFramework = frameworks.some((f) => AGENT_FRAMEWORKS.has(f));
  const hasLlmSdk = frameworks.some(
    (f) => typeof f === 'string' && !f.startsWith('(local-config:') && !AGENT_FRAMEWORKS.has(f)
  );

  const categories = [];
  if (hasAgentFramework)    categories.push('ai_agent');
  if (hasCodingAgentMarker) categories.push('ai_coding_agent');
  if (hasLlmSdk)            categories.push('ai_app');

  return {
    categories,
    primaryCategory: categories[0] || 'ai_app',
  };
}

// Frameworks / SDKs whose presence in a manifest marks a folder as an AI project.
const JS_AI_DEPS = [
  '@anthropic-ai/sdk', '@anthropic-ai/claude-code',
  'openai', '@openai/agents', '@openai/openai-node',
  'ai',
  '@langchain/core', '@langchain/openai', '@langchain/anthropic', 'langchain',
  'llamaindex',
  '@modelcontextprotocol/sdk',
  'autogen', 'crewai',
  '@vercel/ai',
  '@google/generative-ai',
  '@mistralai/mistralai',
  'cohere-ai',
  'replicate',
  'ollama',
];

const PY_AI_DEPS = [
  'openai', 'anthropic',
  'langchain', 'langchain-core', 'langchain-community', 'langgraph',
  'llama-index', 'llamaindex',
  'autogen-agentchat', 'pyautogen', 'autogen',
  'crewai',
  'haystack-ai',
  'google-generativeai',
  'mistralai', 'cohere',
  'huggingface-hub', 'transformers',
  'instructor', 'guidance',
  'mcp',  'modelcontextprotocol',
];

export async function detect(ctx) {
  const findings = [];
  const errors = [];
  let itemsScanned = 0;

  // Collect roots: standard dev folders + every Desktop/Documents candidate
  // (OneDrive's Known Folder Move redirects these on enterprise PCs).
  const desktops = ctx.paths.desktopCandidates || [join(ctx.paths.home, 'Desktop')];
  const documents = ctx.paths.documentsCandidates || [join(ctx.paths.home, 'Documents')];

  const roots = [
    // Under user home
    join(ctx.paths.home, 'projects'),
    join(ctx.paths.home, 'code'),
    join(ctx.paths.home, 'dev'),
    join(ctx.paths.home, 'work'),
    join(ctx.paths.home, 'source', 'repos'),
    join(ctx.paths.home, 'workspace'),
    join(ctx.paths.home, 'Downloads'),
    // Desktop + Documents — local OR OneDrive-redirected
    ...desktops,
    ...documents,
    ...documents.map((d) => join(d, 'GitHub')),
    ...documents.map((d) => join(d, 'projects')),
    // Local system drives: C:\projects, C:\dev, D:\code, etc. (auto-enumerated)
    // and any extra roots from AIGOV_EXTRA_SCAN_ROOTS env var
    ...(ctx.paths.extraDevRoots || []),
  ];

  for (const root of roots) {
    if (!(await exists(root))) continue;
    try {
      const r = await scanRoot(root);
      itemsScanned += r.scanned;
      for (const f of r.findings) findings.push(f);
    } catch (err) {
      errors.push({ message: `${root}: ${err.message}`, recoverable: true });
    }
  }

  return { findings, errors, stats: { itemsScanned } };
}

async function scanRoot(root) {
  let scanned = 0;
  const queue = [{ path: root, depth: 0 }];
  // raw signals keyed by the path where they were detected
  const rawProjects = [];

  while (queue.length && rawProjects.length < MAX_PROJECTS_PER_ROOT * 4) {
    const { path, depth } = queue.shift();
    const entries = await safeReaddir(path);

    if (depth > 0) {
      const projectKind = await classifyProject(path, entries);
      if (projectKind) {
        scanned++;
        rawProjects.push({ ...projectKind, detectedAt: path, depth });
        continue;  // don't recurse into a classified project
      }
    }

    if (depth >= MAX_DEPTH) continue;
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === 'venv' || e.name === '.venv') continue;
      queue.push({ path: join(path, e.name), depth: depth + 1 });
    }
  }

  // Collapse: every raw project rolls up to its "main folder" — the first
  // ancestor under the scan root that isn't a passthrough name like
  // `backend`/`server`/`src`, and isn't the GitHub-zip-style doubled name.
  const grouped = new Map();  // mainPath -> aggregated finding
  for (const raw of rawProjects) {
    const main = mainFolderFor(raw.detectedAt, root);
    const existing = grouped.get(main);
    if (existing) {
      // merge frameworks/signals
      for (const fw of raw.frameworks) {
        if (!existing.frameworks.includes(fw)) existing.frameworks.push(fw);
      }
      existing.subProjectPaths.push(raw.detectedAt);
      if (raw.lastModified && (!existing.lastModified || raw.lastModified > existing.lastModified)) {
        existing.lastModified = raw.lastModified;
      }
    } else {
      grouped.set(main, {
        type: 'agent_project',
        path: main,                                // <-- the MAIN folder
        language: raw.language,
        frameworks: [...raw.frameworks],
        signals: raw.signals,
        lastModified: raw.lastModified,
        subProjectPaths: [raw.detectedAt],
      });
    }
  }

  // Assign category to each grouped finding now that all signals are merged.
  const out = [];
  for (const f of grouped.values()) {
    const { categories, primaryCategory } = categorizeProject(f.frameworks);
    out.push({ ...f, categories, primaryCategory });
  }
  return { findings: out, scanned };
}

// Given a project detected at `detectedPath` under `root`, return the path
// of the "main project folder" — the topmost meaningful directory under root.
// Examples (root = ~/Downloads):
//   ~/Downloads/firegeo-main/firegeo-main         -> ~/Downloads/firegeo-main
//   ~/Downloads/Allset_for_prod/Allset_for_prod/project.webapp/backend
//                                                 -> ~/Downloads/Allset_for_prod
//   ~/Downloads/GENFUZE                           -> ~/Downloads/GENFUZE
function mainFolderFor(detectedPath, root) {
  // Normalize separators for the slice math
  const sep = detectedPath.includes('\\') ? '\\' : '/';
  if (!detectedPath.startsWith(root)) return detectedPath;
  const rel = detectedPath.slice(root.length).replace(/^[\\/]+/, '');
  const parts = rel.split(/[\\/]/).filter(Boolean);
  if (parts.length === 0) return detectedPath;

  // Walk forward, skipping passthrough segments and immediate doubled names
  // until we hit a meaningful name.
  let chosenIdx = 0;
  for (let i = 0; i < parts.length; i++) {
    const name = parts[i].toLowerCase();
    if (PASSTHROUGH_NAMES.has(name)) {
      // Passthrough — try the next segment for the "main name"
      continue;
    }
    // GitHub-zip double-nest: parent and child have the same name
    if (i > 0 && parts[i].toLowerCase() === parts[i - 1].toLowerCase()) {
      // Re-use the outer name as the main folder
      chosenIdx = i - 1;
      break;
    }
    chosenIdx = i;
    break;
  }

  // Re-build the path up to the chosen index
  return [root, ...parts.slice(0, chosenIdx + 1)].join(sep);
}

async function classifyProject(path, entries) {
  const names = new Set(entries.map((e) => e.name));
  const isJS = names.has('package.json');
  const isPython = names.has('pyproject.toml') || names.has('requirements.txt') || names.has('Pipfile');
  if (!isJS && !isPython) return null;

  const frameworks = new Set();
  const signals = [];

  if (isJS) {
    const pkg = await safeReadJson(join(path, 'package.json'));
    if (pkg) {
      const allDeps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
      for (const dep of Object.keys(allDeps)) {
        if (JS_AI_DEPS.includes(dep) || JS_AI_DEPS.some((d) => dep === d || dep.startsWith(d + '/'))) {
          frameworks.add(dep);
        }
      }
      if (pkg.name) signals.push(`name=${pkg.name}`);
    }
  }

  if (isPython) {
    if (names.has('requirements.txt')) {
      const txt = await safeReadText(join(path, 'requirements.txt'), 512 * 1024);
      if (txt) {
        for (const line of txt.split(/\r?\n/)) {
          const dep = line.split(/[=<>!~ ]/, 1)[0]?.trim().toLowerCase();
          if (!dep || dep.startsWith('#')) continue;
          if (PY_AI_DEPS.includes(dep)) frameworks.add(dep);
        }
      }
    }
    if (names.has('pyproject.toml')) {
      const txt = await safeReadText(join(path, 'pyproject.toml'), 512 * 1024);
      if (txt) {
        for (const dep of PY_AI_DEPS) {
          if (new RegExp(`["']${dep}[\\s"']`, 'i').test(txt) || new RegExp(`^\\s*${dep}\\s*=`, 'mi').test(txt)) {
            frameworks.add(dep);
          }
        }
      }
    }
  }

  // Project-local AI agent config dirs raise confidence even without dependencies
  for (const localCfg of ['.cursor', '.claude', '.continue', '.aider.conf.yml', '.cursorrules', 'CLAUDE.md', '.mcp.json']) {
    if (names.has(localCfg)) {
      frameworks.add(`(local-config:${localCfg})`);
    }
  }

  if (frameworks.size === 0) return null;

  const stat = await safeStat(path);
  return {
    type: 'agent_project',
    path,
    language: isJS ? 'javascript' : 'python',
    frameworks: [...frameworks],
    signals,
    lastModified: stat?.mtime?.toISOString() ?? null,
  };
}
