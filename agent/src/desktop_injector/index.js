import { stat, readdir, readFile, access } from 'node:fs/promises';
import { existsSync, constants as fsConstants } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { KNOWN_APPS, candidateAsarsFor } from './known-apps.js';
import { extractAsar, packAsar, cleanup, readJsonFromExtracted, writeFileInExtracted } from './asar.js';
import { renderHookFiles } from './hook-template.js';

export const HOOK_VERSION = '0.6.0';  // pattern catalog brought to full parity with browser-extension/content/patterns.js (gitlab/gcp/jwt/iban/us-phone/internal + Luhn credit-card validation); added Gemini desktop

// The bootstrap filename we set as pkg.main. Hoisted so injectOne can detect a
// package.json whose main already points at us (a prior injection) and avoid
// recording the bootstrap as its own "original main" (a self-require loop).
const BOOTSTRAP_NAME = 'cfai-bootstrap.js';

// Common Electron main-entry locations, in priority order. Used only to RECOVER
// when a prior (buggy) injection overwrote pkg.main with our bootstrap and left
// no valid marker, so the true entry is otherwise unknown. We return the first
// candidate that actually exists in the extracted bundle.
const ORIGINAL_MAIN_CANDIDATES = [
  '.vite/build/index.js',   // electron-forge + Vite (Claude Desktop)
  '.vite/build/main.js',
  'out/main/index.js',      // electron-vite
  'dist/main.js',
  'dist-electron/main.js',
  'build/main.js',
  'app/index.js',
  'src/main.js',
  'main.js',
  'index.js',
];

async function probeOriginalMain(extractedDir) {
  for (const rel of ORIGINAL_MAIN_CANDIDATES) {
    if (existsSync(join(extractedDir, rel))) return rel;
  }
  return null;
}

// Resolve ALL asar paths matching a pattern that may contain a `*` glob
// (typical for versioned dirs like app-1.5.0). Returns them most-recent-first.
//
// We inject EVERY version present, not just the newest: Squirrel apps (Claude
// Desktop) keep several `app-<ver>` folders side by side and launch whichever
// is current, and a pending "Relaunch to update" can switch which one runs.
// Injecting only the newest-by-mtime left the actually-running version unhooked.
//
// Returns the sentinel string '__needs_admin__' (as the sole element) when the
// parent dir requires elevation (WindowsApps), so the caller can surface a
// clear "re-run as Administrator" message instead of silently skipping.
async function resolveAsarPaths(pattern) {
  if (!pattern.includes('*')) {
    return existsSync(pattern) ? [pattern] : [];
  }
  const star = pattern.indexOf('*');
  const head = pattern.slice(0, star);
  const tail = pattern.slice(star + 1);
  const parent = dirname(head);
  if (!existsSync(parent)) return [];

  let entries;
  try {
    entries = await readdir(parent, { withFileTypes: true });
  } catch (e) {
    if (parent.toLowerCase().includes('windowsapps') && (e.code === 'EACCES' || e.code === 'EPERM')) {
      return ['__needs_admin__'];
    }
    return [];
  }
  const matches = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const candidate = join(parent, e.name) + tail;
    if (!existsSync(candidate)) continue;
    const s = await stat(candidate);
    matches.push({ path: candidate, mtime: s.mtimeMs });
  }
  matches.sort((a, b) => b.mtime - a.mtime);
  return matches.map((m) => m.path);
}

// Inject the hook into one app. Idempotent: if the existing injection has the
// same hook version + token fingerprint, we skip. Returns a structured status.
async function injectOne({ app, asarPath, serverUrl, token, log }) {
  const result = {
    appId: app.appId,
    product: app.product,
    vendor: app.vendor,
    asarPath,
    hookVersion: HOOK_VERSION,
    status: 'pending',
    injectedAt: null,
    appVersion: null,
    reason: null,
    macResign: null,   // 'ok' | 'failed' | null (non-Mac)
  };

  let extractedDir;
  try {
    // Pre-check: is the asar writable in place? Snap, Flatpak, AppImage and
    // Microsoft Store installs ship the asar on a read-only mount or under
    // SIP-protected paths. Surface "read-only" as a structured failure so
    // the dashboard can show "OS monitor covers this app" instead of a
    // misleading injection error.
    // For Microsoft Store packages the ASAR lives in the read-only
    // WindowsApps container. When the agent is elevated we take ownership
    // and grant Administrators:F so the normal extract-modify-repack flow
    // works. Non-admin runs fall through to the structured failure below.
    const isStorePath = asarPath.toLowerCase().includes('windowsapps');
    if (isStorePath && process.platform === 'win32') {
      await grantWindowsAppsWrite(asarPath, log);
    }

    try {
      await access(asarPath, fsConstants.W_OK);
    } catch {
      result.status = 'failed';
      result.reason = isStorePath
        ? 'Microsoft Store install — re-run the agent as Administrator to inject (right-click → Run as administrator)'
        : 'asar is read-only (sandboxed install — OS monitor still covers this app)';
      return result;
    }

    extractedDir = await extractAsar(asarPath);

    // Read package.json to find the original main entry point
    const pkg = await readJsonFromExtracted(extractedDir, 'package.json');
    result.appVersion = pkg.version ?? null;

    // Resolve the TRUE original main. This is subtle on re-injection: a prior
    // injection rewrote pkg.main to our bootstrap, so reading pkg.main again
    // would record 'cfai-bootstrap.js' as the "original" — the bootstrap would
    // then require() itself and the host app's real main would never load.
    //
    // Order of trust:
    //   1. Existing marker's originalMain (captured by the first injection) —
    //      unless it too is corrupted to our bootstrap.
    //   2. pkg.main, if it isn't already our bootstrap.
    //   3. Probe the bundle for a known Electron entry (recovers a corrupted
    //      marker, e.g. one written by the pre-fix injector).
    const markerPath = join(extractedDir, 'cfai-injection.json');
    let existingMarker = null;
    if (existsSync(markerPath)) {
      try { existingMarker = JSON.parse(await readFile(markerPath, 'utf8')); } catch { /* corrupt marker */ }
    }

    let originalMain = null;
    if (existingMarker?.originalMain && existingMarker.originalMain !== BOOTSTRAP_NAME) {
      originalMain = existingMarker.originalMain;
    } else if (pkg.main && pkg.main !== BOOTSTRAP_NAME) {
      originalMain = pkg.main;
    } else {
      // Marker missing/corrupted AND pkg.main points at our bootstrap — the
      // true entry is lost. Recover by probing common Electron main locations.
      originalMain = await probeOriginalMain(extractedDir);
      if (!originalMain) {
        result.status = 'failed';
        result.reason = 'cannot determine original main entry (prior injection corrupted package.json); manual reinstall of the app recommended';
        return result;
      }
      log?.warn?.(`desktop_injector: ${app.product} had a corrupted injection — recovered original main as ${originalMain}`);
    }

    // Idempotency: check existing injection
    if (existingMarker) {
      const tokenFp = fingerprintToken(token);
      if (existingMarker.hookVersion === HOOK_VERSION && existingMarker.tokenFp === tokenFp &&
          existingMarker.serverUrl === serverUrl && existingMarker.originalMain === originalMain) {
        result.status = 'already_injected';
        result.injectedAt = existingMarker.injectedAt;
        return result;
      }
    }

    // Render the hook + bootstrap with embedded server URL + token
    const { hookJs, bootstrapJs } = renderHookFiles({
      serverUrl, token,
      appId: app.appId, product: app.product,
      hookVersion: HOOK_VERSION,
      originalMain,
    });

    // Write the two files into the extracted asar
    await writeFileInExtracted(extractedDir, 'cfai-hook.js', hookJs);
    await writeFileInExtracted(extractedDir, 'cfai-bootstrap.js', bootstrapJs);

    // Update package.json to point main at our bootstrap
    pkg.main = 'cfai-bootstrap.js';
    await writeFileInExtracted(extractedDir, 'package.json', JSON.stringify(pkg, null, 2));

    // Drop the injection marker
    const injectedAt = new Date().toISOString();
    const marker = { hookVersion: HOOK_VERSION, tokenFp: fingerprintToken(token), serverUrl, injectedAt, originalMain };
    await writeFileInExtracted(extractedDir, 'cfai-injection.json', JSON.stringify(marker, null, 2));

    // Repack
    await packAsar(extractedDir, asarPath);

    // macOS: Gatekeeper validates the .app bundle's code signature on launch.
    // Modifying app.asar invalidates the signature — without an ad-hoc
    // re-sign, the app refuses to start with "damaged and can't be opened".
    // We strip the Mac App Store signature and apply an ad-hoc signature
    // (`-`), which Gatekeeper accepts for locally-modified apps.
    if (process.platform === 'darwin') {
      const bundlePath = findMacBundle(asarPath);
      if (bundlePath) {
        const reSignOk = await codesignAdhoc(bundlePath);
        result.macResign = reSignOk ? 'ok' : 'failed';
        if (!reSignOk) {
          // Don't fail the whole injection — the user can disable Gatekeeper
          // for the bundle manually, and the marker file is already in place
          // so we won't redo this work. Surface as a warning in the finding.
          result.reason = 'codesign --sign - failed; app may refuse to launch until re-signed manually';
        }
      }
    }

    result.status = 'injected';
    result.injectedAt = injectedAt;
    return result;
  } catch (err) {
    result.status = 'failed';
    result.reason = String(err?.message || err);
    return result;
  } finally {
    if (extractedDir) await cleanup(extractedDir);
  }
}

// Take ownership + grant Administrators full control on the ASAR file so
// the normal extract-modify-repack flow can write it back. Only needed for
// Microsoft Store packages in C:\Program Files\WindowsApps. Requires that
// the agent is running elevated (as Administrator).
async function grantWindowsAppsWrite(asarPath, log) {
  const cmds = [
    ['takeown', ['/f', asarPath, '/a']],
    ['icacls',  [asarPath, '/grant', 'Administrators:F']],
  ];
  for (const [cmd, args] of cmds) {
    await new Promise((resolve) => {
      const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      child.stdout?.on('data', (d) => { out += d; });
      child.stderr?.on('data', (d) => { out += d; });
      child.on('error', () => resolve());
      child.on('exit', (code) => {
        if (code !== 0) log?.warn?.(`desktop_injector: ${cmd} exited ${code}: ${out.trim()}`);
        resolve();
      });
      setTimeout(() => { try { child.kill(); } catch {} resolve(); }, 8000);
    });
  }
}

function fingerprintToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex').slice(0, 12);
}

// Given an asar path like /Applications/Claude.app/Contents/Resources/app.asar,
// walk up to find the .app bundle root. Returns null if the asar isn't inside
// a Mac .app structure (shouldn't happen on Mac but defensive).
function findMacBundle(asarPath) {
  let cur = asarPath;
  for (let i = 0; i < 6; i++) {
    cur = dirname(cur);
    if (cur.endsWith('.app')) return cur;
    if (cur === '/' || cur === '') return null;
  }
  return null;
}

// Ad-hoc re-sign a Mac .app bundle. Returns true on success.
// `--force` overwrites the existing signature; `--deep` re-signs nested
// frameworks/helpers; `--sign -` means ad-hoc (no developer cert needed).
function codesignAdhoc(bundlePath) {
  return new Promise((resolve) => {
    const child = spawn('codesign', ['--force', '--deep', '--sign', '-', bundlePath], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += String(d); });
    child.on('error', () => resolve(false));
    child.on('exit', (code) => resolve(code === 0));
    // No timeout — codesign on a large bundle (200MB Electron) can take 30s.
  });
}

// Entry point — called from the main agent run. Returns an array of findings
// (one per app) that get added to the scan report.
export async function runInjector({ platform, serverUrl, token, log }) {
  const findings = [];
  if (!serverUrl || !token) {
    log?.debug?.('desktop_injector: no server credentials, skipping');
    return findings;
  }

  for (const app of KNOWN_APPS) {
    let needsAdmin = false;
    let injectedAny = false;

    // Collect every concrete asar across all candidate patterns, deduped. We
    // inject ALL of them — a Squirrel app can have several `app-<ver>` folders
    // present at once and launch whichever is current (or switch on update),
    // so hooking only one risks leaving the running version uncovered.
    const seenAsars = new Set();
    for (const pattern of candidateAsarsFor(app, platform)) {
      const asarPaths = await resolveAsarPaths(pattern);
      for (const asarPath of asarPaths) {
        // Sentinel: the ASAR container exists but requires elevation to list/write.
        if (asarPath === '__needs_admin__') {
          needsAdmin = true;
          continue;
        }
        if (seenAsars.has(asarPath)) continue;
        seenAsars.add(asarPath);

        log?.info?.(`desktop_injector: injecting into ${app.product} at ${asarPath}`);
        const result = await injectOne({ app, asarPath, serverUrl, token, log });
        log?.info?.(`desktop_injector: ${app.product} → ${result.status}${result.reason ? ' — ' + result.reason : ''}`);

        findings.push({
          type: 'desktop_hook_status',
          detector: 'desktop_injector',
          vendor: app.vendor,
          product: app.product,
          appId: app.appId,
          appVersion: result.appVersion,
          asarPath: result.asarPath,
          hookVersion: result.hookVersion,
          hookStatus: result.status,
          injectedAt: result.injectedAt,
          reason: result.reason,
          macResign: result.macResign,
          platform,
        });
        if (result.status === 'injected' || result.status === 'already_injected') injectedAny = true;
      }
    }
    if (injectedAny) needsAdmin = false;

    // No writable ASAR found — if at least one pattern needed admin, surface that.
    if (needsAdmin && !findings.find((f) => f.appId === app.appId)) {
      log?.warn?.(`desktop_injector: ${app.product} found in WindowsApps but requires Administrator — re-run as admin to inject`);
      findings.push({
        type: 'desktop_hook_status',
        detector: 'desktop_injector',
        vendor: app.vendor,
        product: app.product,
        appId: app.appId,
        appVersion: null,
        asarPath: null,
        hookVersion: HOOK_VERSION,
        hookStatus: 'failed',
        injectedAt: null,
        reason: 'Microsoft Store install — re-run the agent as Administrator to inject',
        macResign: null,
        platform,
      });
    }
  }

  return findings;
}
