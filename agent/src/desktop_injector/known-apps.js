// Catalog of Electron AI apps we know how to inject into.
//
// For each app, we list candidate asar locations per platform. The injector
// glob-resolves these (most contain a versioned subdir like `app-1.5.0`)
// and picks the most recently modified one — that's the live version.

import os from 'node:os';
import { join } from 'node:path';

const home = os.homedir();
const appData    = process.env.APPDATA       || join(home, 'AppData', 'Roaming');
const localData  = process.env.LOCALAPPDATA  || join(home, 'AppData', 'Local');
const programs   = process.env.PROGRAMFILES  || 'C:\\Program Files';
const programsX86 = process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';
const programData = process.env.PROGRAMDATA  || 'C:\\ProgramData';
// Some Squirrel installers (Claude Desktop's "for this machine" mode) drop the
// app under C:\ProgramData\<username>\<App>\app-<ver>\ — a per-user tree inside
// ProgramData, writable by that user without elevation. Derive the username
// from the env or the home dir basename.
const username = process.env.USERNAME || home.split(/[\\/]/).filter(Boolean).pop() || '';

// Linux: per-user installs (Flatpak's --user, AppImage extracted, npm-installed
// Electron apps) live under $HOME; system installs under /opt or /usr/lib.
// Snap and Flatpak ship asars on read-only squashfs/ostree mounts — the
// injector's W_OK pre-check rejects those cleanly with a "sandboxed install"
// reason; OS-level monitor still covers them.
const linuxHome = join(home, '.local', 'share');
const flatpakUser = join(home, '.local', 'share', 'flatpak', 'app');

export const KNOWN_APPS = [
  {
    appId: 'claude-desktop',
    product: 'Claude',
    vendor: 'Anthropic',
    win32Asars: [
      // Squirrel "for this machine" install — the common real-world layout.
      join(programData, username, 'AnthropicClaude', 'app-*', 'resources', 'app.asar'),
      join(localData, 'AnthropicClaude', 'app-*', 'resources', 'app.asar'),
      join(programs, 'Claude', 'resources', 'app.asar'),
    ],
    darwinAsars: [
      '/Applications/Claude.app/Contents/Resources/app.asar',
    ],
    linuxAsars: [
      '/opt/Claude/resources/app.asar',
      '/usr/lib/claude/resources/app.asar',
    ],
  },
  {
    appId: 'chatgpt-desktop',
    product: 'ChatGPT',
    vendor: 'OpenAI',
    win32Asars: [
      // Direct installer (.exe from openai.com) — writable without elevation
      join(localData, 'Programs', 'chatgpt', 'resources', 'app.asar'),
      join(localData, 'Programs', '@openai-chatgpt', 'resources', 'app.asar'),
      join(programs, 'ChatGPT', 'resources', 'app.asar'),
      // Microsoft Store package — requires running agent as Administrator
      'C:\\Program Files\\WindowsApps\\OpenAI.ChatGPT-Desktop_*\\app\\resources\\app.asar',
    ],
    darwinAsars: [
      '/Applications/ChatGPT.app/Contents/Resources/app.asar',
    ],
    linuxAsars: [
      // ChatGPT desktop on Linux is community-built / unofficial as of 2026-05.
      // These are the most common install layouts we've seen.
      '/opt/chatgpt/resources/app.asar',
      '/usr/lib/chatgpt/resources/app.asar',
      join(linuxHome, 'chatgpt', 'resources', 'app.asar'),
    ],
  },
  {
    appId: 'gemini-desktop',
    product: 'Gemini',
    vendor: 'Google',
    win32Asars: [
      // Direct installer (.exe from gemini.google.com / Google) — per-user,
      // writable without elevation. Google ships the Gemini desktop app as an
      // Electron build; layout mirrors other Squirrel/Electron installers.
      join(localData, 'Programs', 'gemini', 'resources', 'app.asar'),
      join(localData, 'Google', 'Gemini', 'app-*', 'resources', 'app.asar'),
      join(programs, 'Gemini', 'resources', 'app.asar'),
      // Microsoft Store package — requires running agent as Administrator
      'C:\\Program Files\\WindowsApps\\Google.Gemini_*\\app\\resources\\app.asar',
    ],
    darwinAsars: [
      '/Applications/Gemini.app/Contents/Resources/app.asar',
      '/Applications/Google Gemini.app/Contents/Resources/app.asar',
    ],
    linuxAsars: [
      '/opt/Gemini/resources/app.asar',
      '/usr/lib/gemini/resources/app.asar',
      join(linuxHome, 'gemini', 'resources', 'app.asar'),
    ],
  },
  {
    appId: 'cursor',
    product: 'Cursor',
    vendor: 'Anysphere',
    win32Asars: [
      join(localData, 'Programs', 'cursor', 'resources', 'app.asar'),
      join(programs, 'Cursor', 'resources', 'app.asar'),
    ],
    darwinAsars: [
      '/Applications/Cursor.app/Contents/Resources/app.asar',
    ],
    linuxAsars: [
      '/opt/Cursor/resources/app.asar',
      '/usr/share/cursor/resources/app.asar',
    ],
  },
  {
    appId: 'copilot-desktop',
    product: 'Microsoft Copilot',
    vendor: 'Microsoft',
    win32Asars: [
      join(localData, 'Microsoft', 'Copilot', 'app-*', 'resources', 'app.asar'),
    ],
    darwinAsars: [],
    linuxAsars: [],
  },
  {
    appId: 'perplexity-comet',
    product: 'Perplexity Comet',
    vendor: 'Perplexity',
    win32Asars: [
      join(localData, 'Perplexity', 'Comet', 'app-*', 'resources', 'app.asar'),
    ],
    darwinAsars: [
      '/Applications/Comet.app/Contents/Resources/app.asar',
    ],
    linuxAsars: [],
  },
];

export function candidateAsarsFor(app, platform) {
  if (platform === 'win32')  return app.win32Asars  || [];
  if (platform === 'darwin') return app.darwinAsars || [];
  if (platform === 'linux')  return app.linuxAsars  || [];
  return [];
}
