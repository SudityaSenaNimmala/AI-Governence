import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { safeReaddir, exists } from '../util/fs.js';
import { join } from 'node:path';

const execAsync = promisify(exec);

export const name = 'desktop_apps';
export const description = 'Detect installed AI desktop apps and running AI processes';
export const platforms = ['win32', 'darwin', 'linux'];

// Catalog of known AI desktop apps. Keys are normalized identifiers,
// values describe how to recognize the product on each platform.
const AI_APPS = [
  { id: 'chatgpt', vendor: 'OpenAI', product: 'ChatGPT', match: /^chatgpt$/i, processNames: ['ChatGPT', 'ChatGPT.exe'] },
  { id: 'claude-desktop', vendor: 'Anthropic', product: 'Claude', match: /^claude$/i, processNames: ['Claude', 'Claude.exe'] },
  { id: 'cursor', vendor: 'Anysphere', product: 'Cursor', match: /^cursor$/i, processNames: ['Cursor', 'Cursor.exe'] },
  { id: 'copilot-desktop', vendor: 'Microsoft', product: 'Copilot', match: /microsoft copilot/i, processNames: ['Copilot', 'msedgewebview2.exe'] },
  { id: 'perplexity', vendor: 'Perplexity', product: 'Perplexity', match: /^perplexity$/i, processNames: ['Perplexity', 'Perplexity.exe'] },
  { id: 'ollama', vendor: 'Ollama', product: 'Ollama', match: /^ollama$/i, processNames: ['ollama', 'ollama.exe', 'ollama app.exe'] },
  { id: 'lm-studio', vendor: 'Element Labs', product: 'LM Studio', match: /^lm studio$/i, processNames: ['LM Studio', 'LM Studio.exe'] },
  { id: 'msty', vendor: 'Msty', product: 'Msty', match: /^msty$/i, processNames: ['Msty', 'Msty.exe'] },
  { id: 'gpt4all', vendor: 'Nomic AI', product: 'GPT4All', match: /^gpt4all$/i, processNames: ['gpt4all', 'gpt4all.exe'] },
  { id: 'jan', vendor: 'Jan', product: 'Jan', match: /^jan$/i, processNames: ['Jan', 'Jan.exe'] },
  { id: 'github-copilot-app', vendor: 'GitHub', product: 'GitHub Copilot', match: /github copilot/i, processNames: ['GitHubCopilot'] },
  { id: 'character-ai', vendor: 'Character.AI', product: 'Character.AI', match: /character\.?ai/i, processNames: [] },
  { id: 'poe', vendor: 'Quora', product: 'Poe', match: /^poe$/i, processNames: ['Poe', 'Poe.exe'] },
];

export async function detect(ctx) {
  const findings = [];
  const errors = [];
  let itemsScanned = 0;

  try {
    const installed = await listInstalledApps(ctx);
    itemsScanned += installed.length;
    for (const app of installed) {
      const match = AI_APPS.find((a) => a.match.test(app.name));
      if (match) {
        findings.push({
          type: 'desktop_app',
          appId: match.id,
          vendor: match.vendor,
          product: match.product,
          name: app.name,
          version: app.version ?? null,
          installLocation: app.installLocation ?? null,
          installDate: app.installDate ?? null,
        });
      }
    }
  } catch (err) {
    errors.push({ message: `listInstalledApps failed: ${err.message}`, recoverable: true });
  }

  try {
    const processes = await listProcesses(ctx);
    itemsScanned += processes.length;
    for (const proc of processes) {
      const match = AI_APPS.find((a) => a.processNames.some((pn) => pn.toLowerCase() === proc.name.toLowerCase()));
      if (match) {
        findings.push({
          type: 'running_process',
          appId: match.id,
          vendor: match.vendor,
          product: match.product,
          name: proc.name,
          pid: proc.pid,
        });
      }
    }
  } catch (err) {
    errors.push({ message: `listProcesses failed: ${err.message}`, recoverable: true });
  }

  return { findings, errors, stats: { itemsScanned } };
}

// ---- platform-specific implementations ----

async function listInstalledApps(ctx) {
  if (ctx.platform === 'win32') return listInstalledAppsWindows(ctx);
  if (ctx.platform === 'darwin') return listInstalledAppsMac(ctx);
  return listInstalledAppsLinux(ctx);
}

async function listProcesses(ctx) {
  if (ctx.platform === 'win32') return listProcessesWindows();
  return listProcessesUnix();
}

async function listInstalledAppsWindows(ctx) {
  // Query 3 registry uninstall keys: per-machine (64), per-machine (32-on-64), per-user.
  const keys = [
    'HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    'HKLM\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  ];

  const apps = [];
  for (const key of keys) {
    try {
      const { stdout } = await execAsync(`reg query "${key}" /s`, { maxBuffer: 16 * 1024 * 1024, windowsHide: true });
      const blocks = stdout.split(/\r?\n\r?\n/);
      for (const block of blocks) {
        const nameMatch = block.match(/DisplayName\s+REG_SZ\s+(.+)/i);
        if (!nameMatch) continue;
        const versionMatch = block.match(/DisplayVersion\s+REG_SZ\s+(.+)/i);
        const locationMatch = block.match(/InstallLocation\s+REG_SZ\s+(.+)/i);
        const dateMatch = block.match(/InstallDate\s+REG_SZ\s+(\d{8})/i);
        const publisherMatch = block.match(/Publisher\s+REG_SZ\s+(.+)/i);
        apps.push({
          name: nameMatch[1].trim(),
          version: versionMatch?.[1]?.trim() ?? null,
          installLocation: locationMatch?.[1]?.trim() ?? null,
          installDate: dateMatch?.[1]
            ? `${dateMatch[1].slice(0, 4)}-${dateMatch[1].slice(4, 6)}-${dateMatch[1].slice(6, 8)}`
            : null,
          publisher: publisherMatch?.[1]?.trim() ?? null,
        });
      }
    } catch (err) {
      // HKCU may not exist for every user, swallow individual key errors
      ctx.log?.debug?.(`reg query failed for ${key}: ${err.message}`);
    }
  }
  return apps;
}

async function listInstalledAppsMac(ctx) {
  const apps = [];
  const dirs = ['/Applications', join(ctx.paths.home, 'Applications')];
  for (const dir of dirs) {
    if (!(await exists(dir))) continue;
    const entries = await safeReaddir(dir);
    for (const e of entries) {
      if (!e.isDirectory() || !e.name.endsWith('.app')) continue;
      const name = e.name.replace(/\.app$/, '');
      apps.push({ name, version: null, installLocation: join(dir, e.name), installDate: null });
    }
  }
  return apps;
}

async function listInstalledAppsLinux(ctx) {
  // Best-effort: scan .desktop files in standard XDG locations
  const apps = [];
  const dirs = [
    '/usr/share/applications',
    '/var/lib/flatpak/exports/share/applications',
    join(ctx.paths.home, '.local', 'share', 'applications'),
  ];
  for (const dir of dirs) {
    const entries = await safeReaddir(dir);
    for (const e of entries) {
      if (!e.isFile() || !e.name.endsWith('.desktop')) continue;
      const name = e.name.replace(/\.desktop$/, '').replace(/-/g, ' ');
      apps.push({ name, version: null, installLocation: join(dir, e.name), installDate: null });
    }
  }
  return apps;
}

async function listProcessesWindows() {
  const { stdout } = await execAsync('tasklist /FO CSV /NH', { maxBuffer: 8 * 1024 * 1024, windowsHide: true });
  const lines = stdout.trim().split(/\r?\n/);
  return lines.map((line) => {
    const parts = line.split('","').map((p) => p.replace(/^"|"$/g, ''));
    return { name: parts[0]?.replace(/\.exe$/i, '') ?? '', pid: Number(parts[1]) || null };
  }).filter((p) => p.name);
}

async function listProcessesUnix() {
  const { stdout } = await execAsync('ps -A -o pid=,comm=', { maxBuffer: 8 * 1024 * 1024 });
  return stdout.trim().split(/\r?\n/).map((line) => {
    const m = line.trim().match(/^(\d+)\s+(.+)$/);
    if (!m) return null;
    return { pid: Number(m[1]), name: m[2].split('/').pop() };
  }).filter(Boolean);
}
