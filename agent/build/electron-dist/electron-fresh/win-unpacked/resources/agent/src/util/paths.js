import os from 'node:os';
import { join } from 'node:path';
import { statSync } from 'node:fs';

// Common dev folder names we'll look for at the root of each drive
// (and at user-home level), regardless of OS.
const DEV_FOLDER_NAMES = [
  'projects', 'Projects',
  'code', 'Code',
  'dev', 'Dev',
  'work', 'Work',
  'src', 'Src',
  'source', 'sources',
  'repos', 'Repos',
  'workspace', 'workspaces',
  'github', 'GitHub',
  'gitlab',
];

// Enumerate fixed drives on Windows by stat-ing each likely letter root.
// On non-Windows, returns a single "/" pseudo-root.
function enumerateRoots(platform) {
  if (platform !== 'win32') return ['/'];
  const drives = [];
  for (let c = 67; c <= 90; c++) {  // 'C'..'Z' — skip A:/B: (floppies)
    const letter = String.fromCharCode(c);
    const root = `${letter}:\\`;
    try {
      const s = statSync(root);
      if (s.isDirectory()) drives.push(root);
    } catch {}
  }
  return drives;
}

// Combine the configured extras + the dev folders that exist on each drive.
function gatherExtraDevRoots(platform) {
  const env = process.env.AIGOV_EXTRA_SCAN_ROOTS;
  const fromEnv = env
    ? env.split(platform === 'win32' ? ';' : ':').map((s) => s.trim()).filter(Boolean)
    : [];

  const candidates = [...fromEnv];

  for (const driveRoot of enumerateRoots(platform)) {
    for (const name of DEV_FOLDER_NAMES) {
      candidates.push(join(driveRoot, name));
    }
  }

  // De-dupe (case-insensitive on Windows)
  const seen = new Set();
  const out = [];
  for (const c of candidates) {
    const k = platform === 'win32' ? c.toLowerCase() : c;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(c);
  }
  return out;
}

export function getUserPaths(platform) {
  const home = os.homedir();
  const extraDevRoots = gatherExtraDevRoots(platform);

  if (platform === 'win32') {
    const appData = process.env.APPDATA || join(home, 'AppData', 'Roaming');
    const localAppData = process.env.LOCALAPPDATA || join(home, 'AppData', 'Local');

    // OneDrive Known Folder Move: when enabled (common in enterprise),
    // Desktop / Documents / Pictures live under the OneDrive root, NOT under
    // %USERPROFILE%. We pick up both env vars (commercial M365 + consumer).
    const oneDriveRoot = process.env.OneDriveCommercial || process.env.OneDrive || process.env.OneDriveConsumer || null;
    const desktopCandidates = [join(home, 'Desktop')];
    const documentsCandidates = [join(home, 'Documents')];
    if (oneDriveRoot) {
      desktopCandidates.unshift(join(oneDriveRoot, 'Desktop'));
      documentsCandidates.unshift(join(oneDriveRoot, 'Documents'));
    }

    return {
      home,
      appData,
      localAppData,
      programs: localAppData,
      oneDriveRoot,
      desktopCandidates,
      documentsCandidates,
      extraDevRoots,
      browserData: {
        chrome: join(localAppData, 'Google', 'Chrome', 'User Data'),
        edge: join(localAppData, 'Microsoft', 'Edge', 'User Data'),
        brave: join(localAppData, 'BraveSoftware', 'Brave-Browser', 'User Data'),
        firefox: join(appData, 'Mozilla', 'Firefox', 'Profiles'),
      },
      vscodeExtensions: join(home, '.vscode', 'extensions'),
      cursorExtensions: join(home, '.cursor', 'extensions'),
      claudeDesktop: join(appData, 'Claude'),
      claudeCodeConfig: join(home, '.claude'),
      claudeCodeMainJson: join(home, '.claude.json'),  // Claude Code's main config file
      cursorConfig: join(home, '.cursor'),
      continueConfig: join(home, '.continue'),
      codeiumConfig: join(home, '.codeium'),
      ollama: join(home, '.ollama'),
      jetbrainsConfig: join(appData, 'JetBrains'),
    };
  }

  if (platform === 'darwin') {
    const appSupport = join(home, 'Library', 'Application Support');
    return {
      home,
      appData: appSupport,
      localAppData: appSupport,
      programs: '/Applications',
      oneDriveRoot: null,
      desktopCandidates: [join(home, 'Desktop')],
      documentsCandidates: [join(home, 'Documents')],
      extraDevRoots,
      browserData: {
        chrome: join(appSupport, 'Google', 'Chrome'),
        edge: join(appSupport, 'Microsoft Edge'),
        brave: join(appSupport, 'BraveSoftware', 'Brave-Browser'),
        firefox: join(home, 'Library', 'Application Support', 'Firefox', 'Profiles'),
      },
      vscodeExtensions: join(home, '.vscode', 'extensions'),
      cursorExtensions: join(home, '.cursor', 'extensions'),
      claudeDesktop: join(appSupport, 'Claude'),
      claudeCodeConfig: join(home, '.claude'),
      claudeCodeMainJson: join(home, '.claude.json'),
      cursorConfig: join(home, '.cursor'),
      continueConfig: join(home, '.continue'),
      codeiumConfig: join(home, '.codeium'),
      ollama: join(home, '.ollama'),
      jetbrainsConfig: join(home, 'Library', 'Application Support', 'JetBrains'),
    };
  }

  // linux
  const xdgConfig = process.env.XDG_CONFIG_HOME || join(home, '.config');
  const xdgData = process.env.XDG_DATA_HOME || join(home, '.local', 'share');
  return {
    home,
    appData: xdgConfig,
    localAppData: xdgData,
    programs: '/usr/share/applications',
    oneDriveRoot: null,
    desktopCandidates: [join(home, 'Desktop')],
    documentsCandidates: [join(home, 'Documents')],
    extraDevRoots,
    browserData: {
      chrome: join(xdgConfig, 'google-chrome'),
      edge: join(xdgConfig, 'microsoft-edge'),
      brave: join(xdgConfig, 'BraveSoftware', 'Brave-Browser'),
      firefox: join(home, '.mozilla', 'firefox'),
    },
    vscodeExtensions: join(home, '.vscode', 'extensions'),
    cursorExtensions: join(home, '.cursor', 'extensions'),
    claudeDesktop: join(xdgConfig, 'Claude'),
    claudeCodeConfig: join(home, '.claude'),
    claudeCodeMainJson: join(home, '.claude.json'),
    cursorConfig: join(home, '.cursor'),
    continueConfig: join(home, '.continue'),
    codeiumConfig: join(home, '.codeium'),
    ollama: join(home, '.ollama'),
    jetbrainsConfig: join(xdgConfig, 'JetBrains'),
  };
}
