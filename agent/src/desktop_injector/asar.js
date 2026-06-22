// Thin wrapper around @electron/asar. We use the package's createPackage /
// extractAll APIs to read and write app.asar files atomically.

import { readFile, mkdir, rm, writeFile, cp } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import crypto from 'node:crypto';

let asarLib = null;
async function getAsar() {
  if (!asarLib) asarLib = await import('@electron/asar');
  return asarLib.default ?? asarLib;
}

// Extract an asar into a temp dir. Returns the dir path; caller cleans up.
export async function extractAsar(asarPath) {
  const asar = await getAsar();
  const tmpDir = join(tmpdir(), `cfai-asar-${crypto.randomBytes(8).toString('hex')}`);
  await mkdir(tmpDir, { recursive: true });
  asar.extractAll(asarPath, tmpDir);
  return tmpDir;
}

// Repack a directory into an asar, overwriting the destination atomically.
// For normal (writable) paths: write to dest+.cfai-tmp, backup original to
// .cfai-bak, then rename.
// For Windows Store (WindowsApps) paths: pack to a temp file OUTSIDE the
// protected directory, then use robocopy /B (backup-privilege mode) to write
// back — this bypasses MSIX integrity enforcement that blocks direct writes
// even for elevated users.
export async function packAsar(srcDir, destPath) {
  const asar = await getAsar();
  const isStore = destPath.toLowerCase().includes('windowsapps');

  if (isStore && process.platform === 'win32') {
    // Pack to temp outside WindowsApps, then robocopy /B back in.
    const tmpDest = join(tmpdir(), `cfai-asar-out-${crypto.randomBytes(6).toString('hex')}.asar`);
    try {
      await asar.createPackage(srcDir, tmpDest);
      await robocopyBackup(tmpDest, destPath);
    } finally {
      try { const { unlink } = await import('node:fs/promises'); await unlink(tmpDest); } catch {}
    }
    return;
  }

  // Standard path (writable without elevation).
  const backup = destPath + '.cfai-bak';
  try {
    await readFile(backup);  // backup exists, keep it
  } catch {
    await cp(destPath, backup);  // first time: snapshot original
  }
  const tmpDest = destPath + '.cfai-tmp';
  await asar.createPackage(srcDir, tmpDest);
  const { rename, unlink } = await import('node:fs/promises');
  try { await unlink(destPath); } catch {}
  await rename(tmpDest, destPath);
}

// Use robocopy /B (backup semantics) to copy srcFile over destPath.
// Backup mode uses SE_BACKUP_NAME + SE_RESTORE_NAME privileges which let an
// elevated process bypass both DACL and MSIX package-integrity restrictions.
async function robocopyBackup(srcFile, destFile) {
  const { spawn } = await import('node:child_process');
  const srcDir  = dirname(srcFile);
  const destDir = dirname(destFile);
  const fname   = destFile.split(/[\\/]/).pop();
  const srcName = srcFile.split(/[\\/]/).pop();

  // robocopy <srcDir> <destDir> <file> /B /IS /IT /IM /R:1 /W:0 /NP
  // /B  = backup mode (bypasses DACL / MSIX integrity)
  // /IS = include same files (overwrite even if same timestamp)
  // /IT = include tweaked files
  // /IM = include modified files
  // We need srcName == fname; if they differ (unlikely), rename first.
  const actualSrc = srcName === fname ? srcFile : join(srcDir, fname);
  if (srcName !== fname) {
    const { rename } = await import('node:fs/promises');
    await rename(srcFile, actualSrc);
  }

  return new Promise((resolve, reject) => {
    const proc = spawn('robocopy', [srcDir, destDir, fname, '/B', '/IS', '/IT', '/IM', '/R:1', '/W:0', '/NP'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    proc.stdout?.on('data', (d) => { out += d; });
    proc.stderr?.on('data', (d) => { out += d; });
    proc.on('error', reject);
    proc.on('exit', (code) => {
      // robocopy exit codes 0-7 are success/informational; 8+ = error.
      if (code !== null && code >= 8) reject(new Error(`robocopy exited ${code}: ${out.trim().slice(0, 300)}`));
      else resolve();
    });
    setTimeout(() => { try { proc.kill(); } catch {} reject(new Error('robocopy timeout')); }, 15_000);
  });
}

// Restore the .cfai-bak backup, removing the modified asar. Used by uninstall
// or by emergency rollback.
export async function restoreAsar(destPath) {
  const backup = destPath + '.cfai-bak';
  const { rename, unlink } = await import('node:fs/promises');
  try {
    await unlink(destPath);
  } catch {}
  await rename(backup, destPath);
}

export async function cleanup(tmpDir) {
  try { await rm(tmpDir, { recursive: true, force: true }); } catch {}
}

export async function readJsonFromExtracted(extractedDir, relativePath) {
  const buf = await readFile(join(extractedDir, relativePath), 'utf8');
  return JSON.parse(buf);
}

export async function writeFileInExtracted(extractedDir, relativePath, content) {
  const fullPath = join(extractedDir, relativePath);
  await mkdir(dirname(fullPath), { recursive: true });
  await writeFile(fullPath, content, 'utf8');
}
