import { join } from 'node:path';
import { safeReaddir, safeReadJson, safeStat, exists } from '../util/fs.js';
import { inspectMcpServer } from './mcp_inspection.js';

export const name = 'agent_configs';
export const description = 'Detect AI agent configuration folders, MCP servers, and local LLM runtimes';
export const platforms = ['win32', 'darwin', 'linux'];

export async function detect(ctx) {
  const findings = [];
  const errors = [];
  let itemsScanned = 0;

  const configDirs = [
    { kind: 'claude_code', path: ctx.paths.claudeCodeConfig, vendor: 'Anthropic', product: 'Claude Code' },
    { kind: 'cursor', path: ctx.paths.cursorConfig, vendor: 'Anysphere', product: 'Cursor' },
    { kind: 'continue', path: ctx.paths.continueConfig, vendor: 'Continue', product: 'Continue' },
    { kind: 'codeium', path: ctx.paths.codeiumConfig, vendor: 'Codeium', product: 'Codeium' },
    { kind: 'aider', path: join(ctx.paths.home, '.aider'), vendor: 'Aider', product: 'Aider' },
    { kind: 'aider', path: join(ctx.paths.home, '.aider.conf.yml'), vendor: 'Aider', product: 'Aider' },
    { kind: 'crewai', path: join(ctx.paths.home, '.crewai'), vendor: 'CrewAI', product: 'CrewAI' },
    { kind: 'autogen', path: join(ctx.paths.home, '.autogen'), vendor: 'AutoGen', product: 'AutoGen' },
  ];

  for (const cfg of configDirs) {
    const s = await safeStat(cfg.path);
    if (!s) continue;
    itemsScanned++;
    findings.push({
      type: 'agent_config',
      kind: cfg.kind,
      vendor: cfg.vendor,
      product: cfg.product,
      path: cfg.path,
      lastModified: s.mtime.toISOString(),
    });
  }

  // --- MCP servers: Claude Desktop ---
  try {
    const claudeMcp = await readClaudeDesktopMcp(ctx);
    for (const f of claudeMcp) findings.push(f);
  } catch (err) {
    errors.push({ message: `claude_desktop_mcp: ${err.message}`, recoverable: true });
  }

  // --- MCP servers: Claude Code (settings.json + ~/.claude.json per-project) ---
  try {
    const claudeCodeMcp = await readClaudeCodeMcp(ctx);
    for (const f of claudeCodeMcp) findings.push(f);
  } catch (err) {
    errors.push({ message: `claude_code_mcp: ${err.message}`, recoverable: true });
  }

  // --- Claude Code main config (~/.claude.json) — top-level + per-project MCPs ---
  try {
    const mainMcp = await readClaudeCodeMainJson(ctx);
    for (const f of mainMcp) findings.push(f);
  } catch (err) {
    errors.push({ message: `claude_code_main_json: ${err.message}`, recoverable: true });
  }

  // --- MCP servers: Cursor ---
  try {
    const cursorMcp = await readCursorMcp(ctx);
    for (const f of cursorMcp) findings.push(f);
  } catch (err) {
    errors.push({ message: `cursor_mcp: ${err.message}`, recoverable: true });
  }

  // --- Local LLM runtimes ---
  try {
    const ollama = await detectOllama(ctx);
    for (const f of ollama) findings.push(f);
  } catch (err) {
    errors.push({ message: `ollama: ${err.message}`, recoverable: true });
  }

  return { findings, errors, stats: { itemsScanned } };
}

async function readClaudeDesktopMcp(ctx) {
  const findings = [];
  const candidates = [
    join(ctx.paths.claudeDesktop, 'claude_desktop_config.json'),
    join(ctx.paths.home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'),
  ];

  for (const path of candidates) {
    if (!(await exists(path))) continue;
    const cfg = await safeReadJson(path);
    if (!cfg?.mcpServers) continue;
    for (const [serverName, server] of Object.entries(cfg.mcpServers)) {
      findings.push(buildMcpFinding('claude_desktop', serverName, server, path));
    }
    return findings;
  }
  return findings;
}

async function readClaudeCodeMcp(ctx) {
  const findings = [];
  const settingsPath = join(ctx.paths.claudeCodeConfig, 'settings.json');
  if (!(await exists(settingsPath))) return findings;
  const cfg = await safeReadJson(settingsPath);
  if (cfg?.mcpServers) {
    for (const [serverName, server] of Object.entries(cfg.mcpServers)) {
      findings.push(buildMcpFinding('claude_code', serverName, server, settingsPath));
    }
  }
  return findings;
}

async function readClaudeCodeMainJson(ctx) {
  const findings = [];
  const path = ctx.paths.claudeCodeMainJson;
  if (!path || !(await exists(path))) return findings;
  const cfg = await safeReadJson(path);
  if (!cfg) return findings;

  // Top-level mcpServers (rare but allowed)
  if (cfg.mcpServers && typeof cfg.mcpServers === 'object') {
    for (const [serverName, server] of Object.entries(cfg.mcpServers)) {
      findings.push({ ...buildMcpFinding('claude_code', serverName, server, path), scope: 'global' });
    }
  }

  // Per-project MCPs: cfg.projects[<absolute-path>].mcpServers
  if (cfg.projects && typeof cfg.projects === 'object') {
    for (const [projectPath, projectCfg] of Object.entries(cfg.projects)) {
      if (!projectCfg?.mcpServers || typeof projectCfg.mcpServers !== 'object') continue;
      for (const [serverName, server] of Object.entries(projectCfg.mcpServers)) {
        findings.push({
          ...buildMcpFinding('claude_code', serverName, server, path),
          scope: 'project',
          projectPath,
        });
      }
    }
  }

  return findings;
}

async function readCursorMcp(ctx) {
  const findings = [];
  const path = join(ctx.paths.cursorConfig, 'mcp.json');
  if (!(await exists(path))) return findings;
  const cfg = await safeReadJson(path);
  if (!cfg?.mcpServers) return findings;
  for (const [serverName, server] of Object.entries(cfg.mcpServers)) {
    findings.push(buildMcpFinding('cursor', serverName, server, path));
  }
  return findings;
}

function buildMcpFinding(client, serverName, server, configPath) {
  const inspection = inspectMcpServer(server);
  return {
    type: 'mcp_server',
    client,
    serverName,
    command: server.command ?? null,
    args: Array.isArray(server.args) ? server.args : null,
    envKeys: server.env ? Object.keys(server.env) : [],
    configPath,
    serverKind: inspection.kind,    // e.g. 'filesystem', 'postgres', 'github'
    scopes: inspection.scopes,      // ['filesystem'], ['database'], etc.
    targets: inspection.targets,    // concrete data targets — see mcp_inspection.js
  };
}

async function detectOllama(ctx) {
  const findings = [];
  const dir = ctx.paths.ollama;
  if (!(await exists(dir))) return findings;

  const modelsDir = join(dir, 'models', 'manifests');
  if (await exists(modelsDir)) {
    const models = await walkOllamaManifests(modelsDir);
    findings.push({
      type: 'local_llm',
      runtime: 'ollama',
      runtimePath: dir,
      models,
    });
  } else {
    findings.push({
      type: 'local_llm',
      runtime: 'ollama',
      runtimePath: dir,
      models: [],
    });
  }
  return findings;
}

async function walkOllamaManifests(root) {
  // Ollama manifests live at: manifests/<registry>/<namespace>/<name>/<tag>
  const out = [];
  const registries = await safeReaddir(root);
  for (const r of registries) {
    if (!r.isDirectory()) continue;
    const namespaces = await safeReaddir(join(root, r.name));
    for (const ns of namespaces) {
      if (!ns.isDirectory()) continue;
      const names = await safeReaddir(join(root, r.name, ns.name));
      for (const n of names) {
        if (!n.isDirectory()) continue;
        const tags = await safeReaddir(join(root, r.name, ns.name, n.name));
        for (const t of tags) {
          if (!t.isFile()) continue;
          out.push(`${ns.name}/${n.name}:${t.name}`);
        }
      }
    }
  }
  return out;
}
