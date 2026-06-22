#!/usr/bin/env node
// CloudFuze AI Governance Agent — build pipeline.
//
//   node scripts/build.mjs bundle   # JS bundle only
//   node scripts/build.mjs sea      # SEA single binary (for current platform)
//   node scripts/build.mjs all      # bundle + SEA
//
// Output layout (per host platform):
//
//   build/<platform>-<arch>/
//     ai-gov-agent[.exe]                  # SEA-built single binary
//     better_sqlite3.node                 # native dep (copied alongside)
//     README.txt
//
// We can only build for the host platform — Node SEA doesn't cross-compile. To
// produce Mac and Linux binaries, run this script on those platforms (or in CI
// with a matrix of macos-latest / ubuntu-latest / windows-latest runners).

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { copyFile, mkdir, rm, writeFile, readFile, chmod, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const agentRoot = join(__dirname, '..');
const buildRoot = join(agentRoot, 'build');

const platform = process.platform;
const arch = process.arch;
const ext = platform === 'win32' ? '.exe' : '';
const outDir = join(buildRoot, `${platform}-${arch}`);
const bundlePath = join(buildRoot, 'agent.bundle.js');
const seaPrep = join(buildRoot, 'sea-prep.blob');
const seaConfigPath = join(buildRoot, 'sea-config.json');
const binaryName = `ai-gov-agent${ext}`;
const binaryPath = join(outDir, binaryName);

async function bundle() {
  console.log('[1/2] bundling JS with esbuild…');
  const esbuild = await import('esbuild');
  await mkdir(buildRoot, { recursive: true });
  const pkg = JSON.parse(await readFile(join(agentRoot, 'package.json'), 'utf8'));
  await esbuild.build({
    entryPoints: [join(agentRoot, 'src', 'index.js')],
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    outfile: bundlePath,
    // better-sqlite3 is a native module — keep it external so the .node file
    // is loaded at runtime from alongside the binary.
    external: ['better-sqlite3'],
    define: {
      __AGENT_VERSION__: JSON.stringify(pkg.version),
    },
    minify: false,
    sourcemap: false,
    legalComments: 'none',
  });
  const s = await stat(bundlePath);
  console.log(`   ${bundlePath} (${(s.size / 1024).toFixed(1)} KB)`);
}

async function buildSea() {
  console.log(`[2/2] building SEA binary for ${platform}-${arch}…`);
  await mkdir(outDir, { recursive: true });

  // 1. Write SEA config
  await writeFile(seaConfigPath, JSON.stringify({
    main: bundlePath,
    output: seaPrep,
    disableExperimentalSEAWarning: true,
    useSnapshot: false,
    useCodeCache: false,
  }, null, 2));

  // 2. Generate SEA blob
  await execFileAsync(process.execPath, ['--experimental-sea-config', seaConfigPath]);

  // 3. Copy node executable to output path
  await copyFile(process.execPath, binaryPath);
  if (platform !== 'win32') await chmod(binaryPath, 0o755);

  // 4. On macOS, strip the existing signature before injection
  if (platform === 'darwin') {
    try { await execFileAsync('codesign', ['--remove-signature', binaryPath]); } catch {}
  }

  // 5. Inject blob using postject (programmatic API to avoid CLI quoting issues)
  const { inject } = await import('postject');
  const blobData = await readFile(seaPrep);
  await inject(binaryPath, 'NODE_SEA_BLOB', blobData, {
    sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
    machoSegmentName: platform === 'darwin' ? 'NODE_SEA' : undefined,
    overwrite: true,
  });

  // 6. Copy native better-sqlite3 binding next to the binary
  await copyNativeModule(outDir);

  // 7. Drop a README into the dist folder
  await writeFile(join(outDir, 'README.txt'),
    `CloudFuze AI Governance Agent (v0.1.0)\n` +
    `Platform: ${platform}-${arch}\n` +
    `Built: ${new Date().toISOString()}\n\n` +
    `Run: ${binaryName} --help\n`);

  const s = await stat(binaryPath);
  console.log(`   ${binaryPath} (${(s.size / 1024 / 1024).toFixed(1)} MB)`);

  if (platform === 'win32') {
    console.log(`\nNext step (production): sign the binary`);
    console.log(`  signtool sign /tr http://timestamp.digicert.com /td sha256 /fd sha256 /a "${binaryPath}"`);
  } else if (platform === 'darwin') {
    console.log(`\nNext step (production): sign + notarize`);
    console.log(`  codesign --sign "Developer ID Application: CloudFuze, Inc." --options runtime "${binaryPath}"`);
    console.log(`  xcrun notarytool submit "${binaryPath}" --keychain-profile aigov --wait`);
  }
}

async function copyNativeModule(destDir) {
  const sqliteDir = join(agentRoot, 'node_modules', 'better-sqlite3', 'build', 'Release');
  if (!existsSync(sqliteDir)) {
    console.warn(`   WARN: ${sqliteDir} not found — run 'npm install' first`);
    return;
  }
  const candidates = ['better_sqlite3.node', 'better-sqlite3.node'];
  for (const name of candidates) {
    const src = join(sqliteDir, name);
    if (existsSync(src)) {
      await copyFile(src, join(destDir, name));
      console.log(`   copied native module: ${name}`);
      return;
    }
  }
  console.warn(`   WARN: better_sqlite3.node not found in ${sqliteDir}`);
}

async function clean() {
  await rm(buildRoot, { recursive: true, force: true });
}

const cmd = process.argv[2] || 'all';
try {
  if (cmd === 'clean') {
    await clean();
    console.log('cleaned');
  } else if (cmd === 'bundle') {
    await bundle();
  } else if (cmd === 'sea') {
    await buildSea();
  } else if (cmd === 'all') {
    await clean();
    await bundle();
    await buildSea();
    console.log('\nbuild complete.');
  } else {
    console.error(`unknown command: ${cmd}`);
    process.exit(1);
  }
} catch (err) {
  console.error('build failed:', err.message);
  process.exit(1);
}
