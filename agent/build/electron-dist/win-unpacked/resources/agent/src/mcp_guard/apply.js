// Wrap (and revert) the MCP servers in an mcp.json-style config so each one
// launches through cfai-mcp-guard instead of directly. This is how the guard
// gets deployed: the host keeps launching "the server", but the real binary is
// now the guard, which spawns the true server behind it.
//
//   apply(configPath, opts)   rewrite every server to route through the guard
//   revert(configPath)        restore the original launch commands
//
// A timestamped backup is written next to the file on first apply. Each guarded
// entry stashes its original { command, args } under `_cfaiOriginal` and sets
// `cfaiGuarded: true`, so revert is exact and re-apply is idempotent.

import { readFile, writeFile, copyFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const GUARD_ENTRY = join(dirname(fileURLToPath(import.meta.url)), 'index.js');

async function exists(p) { try { await access(p); return true; } catch { return false; } }

export async function apply(configPath, opts = {}) {
  const { serverUrl = null, token = null, threshold = 'high', nodeBin = process.execPath } = opts;
  const raw = await readFile(configPath, 'utf8');
  const cfg = JSON.parse(raw);
  if (!cfg.mcpServers || typeof cfg.mcpServers !== 'object') {
    return { changed: 0, total: 0, reason: 'no mcpServers block' };
  }

  if (!(await exists(configPath + '.cfai-bak'))) {
    await copyFile(configPath, configPath + '.cfai-bak');
  }

  let changed = 0;
  const total = Object.keys(cfg.mcpServers).length;
  for (const [name, server] of Object.entries(cfg.mcpServers)) {
    if (server.cfaiGuarded) continue;                 // idempotent
    const original = { command: server.command, args: Array.isArray(server.args) ? server.args : [] };

    const guardEnv = { ...(server.env || {}), CFAI_GUARD_SERVERNAME: name, CFAI_GUARD_THRESHOLD: threshold };
    if (serverUrl) guardEnv.CFAI_GUARD_SERVER = serverUrl;
    if (token)     guardEnv.CFAI_GUARD_TOKEN = token;

    cfg.mcpServers[name] = {
      ...server,
      command: nodeBin,
      args: [GUARD_ENTRY, '--', original.command, ...original.args],
      env: guardEnv,
      cfaiGuarded: true,
      _cfaiOriginal: original,
    };
    changed++;
  }

  await writeFile(configPath, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
  return { changed, total, guardEntry: GUARD_ENTRY };
}

export async function revert(configPath) {
  const cfg = JSON.parse(await readFile(configPath, 'utf8'));
  if (!cfg.mcpServers) return { reverted: 0 };
  let reverted = 0;
  for (const [name, server] of Object.entries(cfg.mcpServers)) {
    if (!server.cfaiGuarded || !server._cfaiOriginal) continue;
    const { command, args } = server._cfaiOriginal;
    const restored = { ...server, command, args };
    delete restored.cfaiGuarded;
    delete restored._cfaiOriginal;
    // Drop the guard-only env keys we added.
    if (restored.env) {
      for (const k of ['CFAI_GUARD_SERVER', 'CFAI_GUARD_TOKEN', 'CFAI_GUARD_SERVERNAME', 'CFAI_GUARD_THRESHOLD']) {
        delete restored.env[k];
      }
      if (Object.keys(restored.env).length === 0) delete restored.env;
    }
    cfg.mcpServers[name] = restored;
    reverted++;
  }
  await writeFile(configPath, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
  return { reverted };
}

// Small CLI:  node apply.js <configPath> [--revert] [--server URL] [--token T] [--threshold high]
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const configPath = args.find((a) => !a.startsWith('--'));
  const getOpt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  if (!configPath) { console.error('usage: node apply.js <configPath> [--revert] [--server URL] [--token T] [--threshold high]'); process.exit(64); }
  const run = args.includes('--revert')
    ? revert(configPath)
    : apply(configPath, { serverUrl: getOpt('--server'), token: getOpt('--token'), threshold: getOpt('--threshold') || 'high' });
  run.then((r) => console.log(JSON.stringify(r, null, 2))).catch((e) => { console.error(e.message); process.exit(1); });
}
