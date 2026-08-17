// Prepare the Claude Usage Tracker installer ON THE SERVER.
//
// WHY THIS EXISTS
//
// The download endpoint serves a prebuilt artifact, and producing that artifact
// used to require a Windows machine: a SEA binary is the `node` executable with a
// blob injected, and the build copied the RUNNING node as its base. So a Linux
// deploy could not make the .exe, and the endpoint answered 501 until somebody
// built it by hand and copied ~85 MB onto the host. That is a manual step in the
// middle of an otherwise scripted deploy, and it is the step that was missed.
//
// It is not actually a platform limit. postject injects through LIEF, which parses
// PE regardless of the host, and nodejs.org publishes the bare Windows executable
// (…/win-x64/node.exe) with SHASUMS256.txt to verify it. Verified both before
// building on it: a blob injected into a linux-x64 ELF from a win32 host produces a
// valid ELF, and a tracker built from a downloaded base binary runs and enrols.
//
// WHY AT RUNTIME AND NOT IN THE IMAGE
//
// The binary has the server URL and the ENROLL_SECRET baked in. Building it during
// `docker build` would mean passing the secret as a build arg, where it is
// recoverable from the image history forever. Building it here uses the values the
// container already holds, so the secret stays in the server's .env — and the
// artifact automatically follows a change of URL or secret instead of silently
// serving a stale one.
//
// Runs in the background after listen: the first minute after a deploy the
// download still answers 501 (with its usual instructions), and then it works.

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const AGENT_DIR = join(__dirname, '..', '..', '..', 'agent');
const DATA_DIR = join(__dirname, '..', '..', 'data');

// win32-x64 because that is what the Setup page offers and what employees run.
const TARGET = (process.env.CFAI_TRACKER_TARGET || 'win32-x64').trim();

// Marker recording what the artifact on disk was built FROM. Without it a restart
// either rebuilds 85 MB it already has, or keeps an installer pointing at an old
// URL after the config changed — and nothing on screen would say which.
const MARKER = '.built-with';

function stampFor(serverUrl, enrollSecret) {
  return createHash('sha256')
    .update([serverUrl, enrollSecret, TARGET, process.version].join('|'))
    .digest('hex');
}

export function claudeTrackerOutDir() {
  return join(AGENT_DIR, 'prebuilt', `claude-tracker-${TARGET}`);
}

// Resolves when the artifact is present and current. Never throws: a missing
// installer degrades one download button, and the route already explains itself.
export async function ensureClaudeTracker({ serverUrl, enrollSecret, log = console }) {
  if (process.env.CFAI_TRACKER_AUTOBUILD === '0') {
    log.log?.('[tracker] auto-build disabled (CFAI_TRACKER_AUTOBUILD=0)');
    return { built: false, reason: 'disabled' };
  }
  if (!serverUrl) return { built: false, reason: 'no server url configured' };

  const script = join(AGENT_DIR, 'scripts', 'build-claude-tracker.mjs');
  if (!existsSync(script)) return { built: false, reason: 'agent build script not present' };

  const outDir = claudeTrackerOutDir();
  const stamp = stampFor(serverUrl, enrollSecret);
  const markerPath = join(outDir, MARKER);
  const exeName = TARGET.startsWith('win32') ? 'CloudFuzeClaudeTracker.exe' : 'CloudFuzeClaudeTracker';

  // Both checks matter: a marker with no binary beside it is a half-finished build
  // from a container that died mid-way, and must not be mistaken for a good one.
  if (existsSync(markerPath) && existsSync(join(outDir, exeName))) {
    try {
      if (readFileSync(markerPath, 'utf8').trim() === stamp) {
        log.log?.(`[tracker] installer already built for ${serverUrl} (${TARGET})`);
        return { built: false, reason: 'up to date' };
      }
    } catch { /* unreadable marker — rebuild */ }
    log.log?.('[tracker] server url or enroll secret changed — rebuilding installer');
  }

  mkdirSync(outDir, { recursive: true });
  log.log?.(`[tracker] building ${TARGET} installer for ${serverUrl} — a few minutes, download answers 501 until it lands`);

  const code = await new Promise((resolve) => {
    const child = spawn(process.execPath, [script], {
      cwd: AGENT_DIR,
      env: {
        ...process.env,
        CFAI_TRACKER_TARGET: TARGET,
        CFAI_TRACKER_OUT: outDir,
        // Cached in the data volume so a restart does not re-download 84 MB.
        CFAI_TRACKER_CACHE: join(DATA_DIR, 'tracker-base'),
        CFAI_SERVER_URL: serverUrl,
        CFAI_ENROLL_SECRET: enrollSecret || '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    // Forwarded with a prefix rather than inherited: this runs while the server is
    // already serving, so its output has to be attributable in the log.
    const relay = (buf) => String(buf).split('\n').filter(Boolean).forEach((l) => log.log?.(`[tracker] ${l.trim()}`));
    child.stdout.on('data', relay);
    child.stderr.on('data', relay);
    child.on('error', (err) => { log.warn?.(`[tracker] could not start build: ${err.message}`); resolve(-1); });
    child.on('close', resolve);
  });

  if (code !== 0) {
    log.warn?.(`[tracker] installer build failed (exit ${code}) — the .exe download will answer 501`);
    return { built: false, reason: `build exited ${code}` };
  }

  if (!existsSync(join(outDir, exeName))) {
    log.warn?.('[tracker] build reported success but produced no binary');
    return { built: false, reason: 'no binary produced' };
  }

  // Written last, and only after the binary is confirmed present, so the marker
  // can never claim more than what is actually on disk.
  writeFileSync(markerPath, stamp + '\n');
  log.log?.(`[tracker] installer ready: ${outDir}`);
  return { built: true, outDir };
}
