#!/usr/bin/env node
// Builds the Claude Usage Tracker as a Node SEA single binary.
//
//   node scripts/build-claude-tracker.mjs
//
// Configuration is baked in at build time from env vars:
//   CFAI_SERVER_URL      e.g. http://165.22.223.59:8787   (default http://localhost:8787)
//   CFAI_ENROLL_SECRET   the server's ENROLL_SECRET
//
// Output: build/claude-tracker-<platform>-<arch>/
//   CloudFuzeClaudeTracker[.exe]   the binary
//   prompt-watcher.ps1             UIA helper — MUST stay beside the binary
//   README.txt
//
// Unlike the full agent this bundle has no native dependencies (no
// better-sqlite3), so the only side file is the PowerShell helper.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { copyFile, mkdir, rm, writeFile, readFile, chmod, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const agentRoot = join(__dirname, '..');
const buildRoot = join(agentRoot, 'build');

const platform = process.platform;
const arch = process.arch;
const ext = platform === 'win32' ? '.exe' : '';
const outDir = join(buildRoot, `claude-tracker-${platform}-${arch}`);
const bundlePath = join(buildRoot, 'claude-tracker.bundle.js');
const seaPrep = join(buildRoot, 'claude-tracker-sea-prep.blob');
const seaConfigPath = join(buildRoot, 'claude-tracker-sea-config.json');
const binaryName = `CloudFuzeClaudeTracker${ext}`;
const binaryPath = join(outDir, binaryName);

const SERVER_URL = process.env.CFAI_SERVER_URL || 'http://localhost:8787';
const ENROLL_SECRET = process.env.CFAI_ENROLL_SECRET || 'dev-enroll-secret-change-me';

async function bundle() {
  console.log('[1/3] bundling with esbuild…');
  const esbuild = await import('esbuild');
  await mkdir(buildRoot, { recursive: true });
  const pkg = JSON.parse(await readFile(join(agentRoot, 'package.json'), 'utf8'));

  await esbuild.build({
    entryPoints: [join(agentRoot, 'src', 'claude_tracker', 'index.js')],
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    outfile: bundlePath,
    define: {
      __CFAI_SERVER_URL__: JSON.stringify(SERVER_URL),
      __CFAI_ENROLL_SECRET__: JSON.stringify(ENROLL_SECRET),
      __CFAI_TRACKER_VERSION__: JSON.stringify(pkg.version),
    },
    minify: false,
    sourcemap: false,
    legalComments: 'none',
  });

  const s = await stat(bundlePath);
  console.log(`   ${bundlePath} (${(s.size / 1024).toFixed(1)} KB)`);
  console.log(`   server baked in: ${SERVER_URL}`);
  console.log(`   enroll secret baked in: ${ENROLL_SECRET ? 'yes' : 'NO — set CFAI_ENROLL_SECRET'}`);
}

async function buildSea() {
  console.log(`[2/3] building SEA binary for ${platform}-${arch}…`);
  await mkdir(outDir, { recursive: true });

  await writeFile(seaConfigPath, JSON.stringify({
    main: bundlePath,
    output: seaPrep,
    disableExperimentalSEAWarning: true,
    useSnapshot: false,
    useCodeCache: false,
  }, null, 2));

  await execFileAsync(process.execPath, ['--experimental-sea-config', seaConfigPath]);

  await copyFile(process.execPath, binaryPath);
  if (platform !== 'win32') await chmod(binaryPath, 0o755);
  if (platform === 'darwin') {
    try { await execFileAsync('codesign', ['--remove-signature', binaryPath]); } catch {}
  }

  const { inject } = await import('postject');
  const blobData = await readFile(seaPrep);
  await inject(binaryPath, 'NODE_SEA_BLOB', blobData, {
    sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
    machoSegmentName: platform === 'darwin' ? 'NODE_SEA' : undefined,
    overwrite: true,
  });

  const s = await stat(binaryPath);
  console.log(`   ${binaryPath} (${(s.size / 1024 / 1024).toFixed(1)} MB)`);
}

async function stage() {
  console.log('[3/3] staging side files…');
  // The UIA helper must sit beside the binary — the tracker looks for it there.
  await copyFile(
    join(agentRoot, 'src', 'os_monitor', 'prompt-watcher.ps1'),
    join(outDir, 'prompt-watcher.ps1'),
  );
  console.log('   copied prompt-watcher.ps1');

  await writeFile(join(outDir, 'README.txt'),
    `CloudFuze Claude Usage Tracker\n` +
    `Platform: ${platform}-${arch}\n` +
    `Built:    ${new Date().toISOString()}\n` +
    `Server:   ${SERVER_URL}\n\n` +
    `WHAT IT DOES\n` +
    `  Counts Claude prompts per user and reports them to CloudFuze AI Governance.\n` +
    `    - Claude Desktop\n` +
    `    - claude.ai in Chrome / Edge / Brave / Firefox\n` +
    `    - claude.ai/code (reported separately as "Claude Code (web)")\n` +
    `  It also switches on Claude Code CLI telemetry, which reports REAL token\n` +
    `  counts and cost.\n\n` +
    `WHAT IT DOES NOT DO\n` +
    `  - Prompt text never leaves this machine (only a character count is sent).\n` +
    `  - No DLP scanning, no browser history reading, no traffic interception.\n` +
    `  - Only claude.ai is looked at. Other sites are ignored entirely: the URL is\n` +
    `    checked BEFORE any text box is read.\n\n` +
    `HOW TO RUN\n` +
    `  Keep both files in the same folder, then double-click ${binaryName}\n` +
    `  (or run it from a terminal to watch the log).\n` +
    `  Leave the window open — closing it stops tracking. Ctrl+C to stop.\n\n` +
    `REQUIREMENTS\n` +
    `  Windows 10/11. No admin rights needed. No configuration needed.\n\n` +
    `NOTE\n` +
    `  If a Claude Code session is already open, restart it so telemetry applies.\n`);
  console.log('   wrote README.txt');
}

try {
  await rm(outDir, { recursive: true, force: true });
  await bundle();
  await buildSea();
  await stage();
  console.log(`\nDone. Ship the whole folder:\n  ${outDir}`);
  if (platform === 'win32') {
    console.log(`\nOptional (avoids SmartScreen warnings on other machines):`);
    console.log(`  signtool sign /tr http://timestamp.digicert.com /td sha256 /fd sha256 /a "${binaryPath}"`);
  }
} catch (err) {
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
}
