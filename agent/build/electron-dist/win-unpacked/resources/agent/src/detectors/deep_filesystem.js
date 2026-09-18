import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { KEY_PATTERNS, ENV_VAR_HINTS, fingerprintKey, AGENT_FILE_HINTS } from '../util/key-patterns.js';

export const name = 'deep_filesystem';
export const description = 'Deep filesystem walk — find API keys and agent markers anywhere on local drives';
export const platforms = ['win32', 'darwin', 'linux'];

// Budgets — keep the scan bounded so the agent never hangs a user's machine.
const MAX_FILES        = Number(process.env.AIGOV_DEEP_MAX_FILES) || 30_000;
const MAX_DURATION_MS  = Number(process.env.AIGOV_DEEP_MAX_MS)    || 4 * 60 * 1000;  // 4 min
const MAX_FILE_BYTES   = Number(process.env.AIGOV_DEEP_MAX_BYTES) || 1_048_576;       // 1 MB
const MAX_DEPTH        = Number(process.env.AIGOV_DEEP_MAX_DEPTH) || 8;

// File extensions we'll open and scan (everything else is skipped without reading).
const INCLUDE_EXT = new Set([
  '', '.env', '.envrc',
  '.json', '.yaml', '.yml', '.toml', '.ini', '.conf', '.config', '.cfg', '.properties',
  '.sh', '.bash', '.zsh', '.ps1', '.psm1', '.cmd', '.bat',
  '.py', '.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs',
  '.rs', '.go', '.rb', '.php', '.java', '.kt', '.swift', '.cs', '.scala',
  '.md', '.mdx', '.txt', '.log', '.tf', '.tfvars', '.tpl',
  '.sql', '.gradle', '.lock', '.dockerfile',
]);

// Filenames we ALWAYS scan regardless of extension.
const INCLUDE_FILE = new Set([
  '.env', '.envrc', '.npmrc', '.netrc', '.bashrc', '.zshrc', '.zprofile',
  '.bash_profile', '.profile', '.zshenv',
  'Dockerfile', 'docker-compose.yml', 'docker-compose.yaml',
  'Makefile', 'CLAUDE.md', 'AGENTS.md', '.cursorrules', '.mcp.json',
  'claude_desktop_config.json',
]);

// Directories to skip entirely (case-insensitive on Windows).
const SKIP_DIR_NAMES = new Set([
  'node_modules', '.git', '.hg', '.svn',
  'venv', '.venv', 'env', '__pycache__', '.tox', '.pytest_cache',
  'dist', 'build', 'out', 'target', 'bin', 'obj',
  '.next', '.nuxt', '.cache', '.parcel-cache', '.turbo',
  '.vscode-test', 'coverage', '.nyc_output',
  '$Recycle.Bin', 'System Volume Information',
  '.DS_Store',
  // Browser data and OS-managed caches — high false-positive rate from
  // binary cache files whose random bytes happen to look like keys.
  'Cache', 'Cache_Data', 'Code Cache', 'GPUCache', 'Service Worker',
  'IndexedDB', 'Session Storage', 'Local Storage', 'shared_proto_db',
  // Claude Code internal data — covered by the targeted detector already
  // and produces a lot of "key in old file version" noise.
  'file-history', 'shell-snapshots', 'paste-cache', 'image-cache',
  'projects',  // Claude Code's per-project journals (NOT the user's projects dir)
]);

// Subpaths that should be skipped wholesale (substring match). These are
// vendor app data and package-manager caches that produce noise — strings
// inside shipped JS bundles or content-addressed cache hashes happen to
// match key patterns. User-written content lives in Desktop/Documents/etc.
const SKIP_SUBPATH_NAMES = [
  /\\Google\\Chrome\\User Data\\/i,
  /\\Microsoft\\Edge\\User Data\\/i,
  /\\BraveSoftware\\Brave-Browser\\User Data\\/i,
  /\\Mozilla\\Firefox\\Profiles\\/i,
  /\\\.claude\\projects\\/i,
  /\\\.cursor\\projects\\/i,
  // Skip all of AppData — it's app state, not user content. The targeted
  // detectors (agent_configs, ide_extensions) already pick up the specific
  // AppData paths we care about.
  /\\AppData\\Local\\/i,
  /\\AppData\\LocalLow\\/i,
  /\\AppData\\Roaming\\(?!Claude\\claude_desktop_config\.json)/i,
  // Package manager caches (POSIX too)
  /\/\.npm\/_cacache\//i,
  /\/\.pnpm-store\//i,
  /\/\.yarn\/cache\//i,
  /\/\.cache\/pip\//i,
  /\/\.cargo\/registry\//i,
];

// Windows system roots — never descend into these even if they're on the scan path.
const WIN_SYSTEM_PREFIXES = [
  /^C:\\Windows(\\|$)/i,
  /^C:\\Program Files(\\|$)/i,
  /^C:\\Program Files \(x86\)(\\|$)/i,
  /^C:\\ProgramData\\(Microsoft|Package Cache|chocolatey|NVIDIA)(\\|$)/i,
  /^C:\\\$Recycle\.Bin/i,
  /^C:\\System Volume Information/i,
];

const POSIX_SYSTEM_PREFIXES = [
  /^\/proc(\/|$)/, /^\/sys(\/|$)/, /^\/dev(\/|$)/, /^\/var\/cache(\/|$)/,
  /^\/usr\/lib(\/|$)/, /^\/usr\/share(\/|$)/, /^\/Library\/Caches(\/|$)/,
];

function isSystemPath(path, platform) {
  const prefixes = platform === 'win32' ? WIN_SYSTEM_PREFIXES : POSIX_SYSTEM_PREFIXES;
  return prefixes.some((re) => re.test(path));
}

export async function detect(ctx) {
  const findings = [];
  const errors = [];
  const stats = { filesWalked: 0, filesScanned: 0, dirsWalked: 0, skippedTooBig: 0, durationMs: 0 };
  const startTs = Date.now();

  const roots = computeRoots(ctx);
  ctx.log.debug?.(`deep-scan roots: ${roots.join(', ')}`);
  const seenFingerprints = new Set();  // de-dupe per scan

  for (const root of roots) {
    if (timedOut(startTs)) break;
    try {
      await walk(root, 0, ctx, findings, errors, stats, startTs, seenFingerprints);
    } catch (err) {
      errors.push({ message: `walk ${root}: ${err.message}`, recoverable: true });
    }
  }

  stats.durationMs = Date.now() - startTs;
  return { findings, errors, stats };
}

function timedOut(startTs) {
  return Date.now() - startTs > MAX_DURATION_MS;
}

function computeRoots(ctx) {
  const platform = ctx.platform;
  const out = [];

  if (platform === 'win32') {
    // Walk the user's home (covers ~\Documents, ~\Desktop, ~\Downloads, etc.)
    out.push(ctx.paths.home);
    // Plus the OneDrive root if present (since it lives outside USERPROFILE)
    if (ctx.paths.oneDriveRoot) out.push(ctx.paths.oneDriveRoot);
    // Plus extras (other drives, common dev folder roots)
    for (const r of ctx.paths.extraDevRoots || []) out.push(r);
  } else {
    out.push(ctx.paths.home);
    for (const r of ctx.paths.extraDevRoots || []) out.push(r);
  }

  // De-dupe
  return [...new Set(out)];
}

async function walk(path, depth, ctx, findings, errors, stats, startTs, seen) {
  if (timedOut(startTs)) return;
  if (depth > MAX_DEPTH) return;
  if (stats.filesScanned >= MAX_FILES) return;
  if (isSystemPath(path, ctx.platform)) return;
  if (SKIP_SUBPATH_NAMES.some((re) => re.test(path))) return;

  let entries;
  try {
    entries = await readdir(path, { withFileTypes: true });
  } catch {
    return;
  }
  stats.dirsWalked++;

  for (const e of entries) {
    if (timedOut(startTs) || stats.filesScanned >= MAX_FILES) return;

    const childPath = join(path, e.name);

    if (e.isSymbolicLink()) continue;  // don't follow symlinks (avoid loops)

    if (e.isDirectory()) {
      if (SKIP_DIR_NAMES.has(e.name)) continue;
      if (e.name.startsWith('.') && !ALLOWED_DOT_DIRS.has(e.name)) continue;  // skip most hidden dirs
      await walk(childPath, depth + 1, ctx, findings, errors, stats, startTs, seen);
      continue;
    }

    if (!e.isFile()) continue;
    stats.filesWalked++;

    // Pick which files we'll actually open
    if (!shouldScanFile(e.name)) continue;

    try {
      const s = await stat(childPath);
      if (s.size > MAX_FILE_BYTES) { stats.skippedTooBig++; continue; }

      const buf = await readFile(childPath);
      // Binary heuristic: if there's a NUL byte in the first 4KB, it's binary.
      const probe = buf.subarray(0, Math.min(4096, buf.length));
      if (probe.includes(0)) continue;

      const text = buf.toString('utf8');
      stats.filesScanned++;
      scanText(text, childPath, findings, seen);

      // Agent marker by filename
      for (const hint of AGENT_FILE_HINTS) {
        if (hint.test(e.name)) {
          findings.push({
            type: 'agent_marker',
            kind: hint.kind,
            filename: e.name,
            path: childPath,
          });
          break;
        }
      }
    } catch {
      // unreadable / locked file — silently skip
    }
  }
}

// Hidden directories we DO want to traverse (config-bearing).
const ALLOWED_DOT_DIRS = new Set([
  '.claude', '.cursor', '.continue', '.codeium', '.aider', '.config',
  '.aws', '.gcloud', '.azure',  // cloud configs often contain credentials
  '.github',
]);

function shouldScanFile(name) {
  if (INCLUDE_FILE.has(name)) return true;
  if (name.startsWith('.env')) return true;  // .env.local, .env.production, etc.
  const dot = name.lastIndexOf('.');
  const ext = dot >= 0 ? name.slice(dot).toLowerCase() : '';
  return INCLUDE_EXT.has(ext);
}

function scanText(text, location, findings, seen) {
  // 1. Strict key patterns
  for (const { provider, regex, severity } of KEY_PATTERNS) {
    regex.lastIndex = 0;
    let m;
    while ((m = regex.exec(text)) !== null) {
      const fp = fingerprintKey(m[1]);
      const seenKey = `${provider}|${fp}|${location}`;
      if (seen.has(seenKey)) continue;
      seen.add(seenKey);
      findings.push({
        type: 'api_key',
        provider,
        location,
        fingerprint: fp,
        length: m[1].length,
        severity,
        discoveredVia: 'deep_filesystem',
      });
    }
  }

  // 2. Env-var hints (catches cases where the value doesn't fit a strict pattern)
  for (const { provider, name: varName } of ENV_VAR_HINTS) {
    const r = new RegExp(`(?:^|\\n|export\\s+)${varName}\\s*=\\s*["']?([^\\s"'#]+)["']?`, 'g');
    let m;
    while ((m = r.exec(text)) !== null) {
      const fp = fingerprintKey(m[1]);
      const seenKey = `${provider}|${fp}|${location}`;
      if (seen.has(seenKey)) continue;
      seen.add(seenKey);
      findings.push({
        type: 'api_key',
        provider,
        envVar: varName,
        location,
        fingerprint: fp,
        length: m[1].length,
        inferred: true,
        discoveredVia: 'deep_filesystem',
      });
    }
  }
}
