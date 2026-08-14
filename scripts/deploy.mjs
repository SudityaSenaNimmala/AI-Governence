#!/usr/bin/env node
// GStack deploy — ship the app stack (server + connect-ui + mongo) to a remote
// Docker host and bring it up. Invoked by `npm run deploy`.
//
// WHY THIS SHAPE (not `docker compose` over DOCKER_HOST=ssh):
//   - buildx-over-SSH is unreliable on small hosts (drops the build connection).
//   - the Vite build OOMs on a <1GB box.
// So we build the FRONTEND LOCALLY, stream the source to the host over one SSH
// connection, and build the images NATIVELY on the host in a single session.
//
// Config (env vars, or put them in .env):
//   DEPLOY_SSH   user@host   e.g. root@165.22.223.59      (REQUIRED)
//   DEPLOY_KEY   ssh key path                              (default ~/.ssh/ai_gov_deploy)
//   DEPLOY_DIR   remote project dir                        (default /opt/ai-gov)
//
// Requires: bash + tar + ssh + scp locally; Docker + compose on the host;
// a .env file here with JWT_SECRET (shipped to the host for compose).

import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

// --- config (env overrides .env) ---
const dotenv = {};
if (existsSync(resolve(root, '.env'))) {
  for (const line of readFileSync(resolve(root, '.env'), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) dotenv[m[1]] = m[2];
  }
}
const cfg = (k, d) => process.env[k] || dotenv[k] || d;
const SSH_TARGET = cfg('DEPLOY_SSH');
const KEY = cfg('DEPLOY_KEY', resolve(homedir(), '.ssh/ai_gov_deploy'));
const DIR = cfg('DEPLOY_DIR', '/opt/ai-gov');
const HOST = SSH_TARGET ? SSH_TARGET.split('@').pop() : null;

function die(msg) { console.error(`✗ ${msg}`); process.exit(1); }
function sh(cmd) {
  console.log(`  $ ${cmd.length > 120 ? cmd.slice(0, 117) + '...' : cmd}`);
  const r = spawnSync('bash', ['-c', cmd], { cwd: root, stdio: 'inherit' });
  if (r.status !== 0) die(`command failed (exit ${r.status})`);
}

// --- preflight ---
if (!SSH_TARGET) die('DEPLOY_SSH is not set (e.g. DEPLOY_SSH=root@165.22.223.59). Put it in .env or the environment.');
if (!existsSync(KEY)) die(`SSH key not found: ${KEY}`);
const SSH = `ssh -i "${KEY}" -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ServerAliveInterval=30 ${SSH_TARGET}`;

console.log(`\n▶ Deploying to ${SSH_TARGET}:${DIR}\n`);

// Secrets (MONGODB_URI, ENCRYPTION_KEY, JWT_SECRET, …) live ONLY in the
// server's own ${DIR}/.env. We never ship or overwrite it — verify it's there.
console.log('• Verifying server .env (secrets stay on the server)…');
const envCheck = spawnSync('bash', ['-c', `${SSH} "test -f ${DIR}/.env"`], { cwd: root });
if (envCheck.status !== 0) {
  die(`No ${DIR}/.env on the server. Create it ONCE on the host with your secrets ` +
      `(MONGODB_URI, ENCRYPTION_KEY, JWT_SECRET, ENROLL_SECRET — see .env.example). ` +
      `Deploy never ships secrets.`);
}

// ADMIN_TOKEN gates the server's admin-only routes (Session Replay playback,
// SIEM export, integration keys, approvals). Same "server owns its secrets" rule
// as above: generate it ONCE, server-side, if it's not already there — never
// overwrite an existing value, never print it, never let it pass through sh()'s
// command-echo.
console.log('• Ensuring server ADMIN_TOKEN exists (generated once if missing)…');
// openssl, not node -e: the bare host only guarantees bash/tar/ssh/docker (per
// the file header) — Node only exists INSIDE the containers this deploy builds.
const ensureToken = spawnSync('bash', ['-c',
  `${SSH} "grep -q '^ADMIN_TOKEN=' ${DIR}/.env || ` +
  `echo ADMIN_TOKEN=\\$(openssl rand -hex 32) >> ${DIR}/.env"`,
], { cwd: root });
if (ensureToken.status !== 0) die('failed to ensure ADMIN_TOKEN on the server');

// The token is deliberately NOT read back, and deliberately NOT handed to the
// Vite build.
//
// This step used to read ADMIN_TOKEN off the host and pass it as
// VITE_ADMIN_TOKEN so the dashboard's replay player could send it. That leaked
// the production admin token to every visitor: Vite substitutes
// `import.meta.env.VITE_*` with a string literal at build time, so the value
// landed in connect-ui/dist as
//     headers:{Authorization:"Bearer <real prod token>"}
// and dist is served publicly at http://<host>:3000/CloudFuze. Verified by
// building with a sentinel value and grepping the bundle.
//
// Passing it "via the child process env, never in a shell string" — the old
// comment here — guards the log/echo channel only. The bundler does not care how
// the variable arrived. A browser-reachable admin credential unlocks session
// replays (screen recordings of employees), SIEM export and approvals, so the
// build gets nothing.
//
// Consequence, accepted on purpose: replay PLAYBACK is unavailable in a deployed
// dashboard until the admin routes accept a real user session. adminFetch() in
// AIHubPage.jsx already sends credentials:"same-origin", so the day the server
// sets a session cookie this needs no change, and until then the player shows
// its explicit "needs an admin credential" panel. A feature that requires an
// admin credential must not work by giving that credential to everyone.
//
// Local development is unaffected: a developer can still put VITE_ADMIN_TOKEN in
// connect-ui/.env.local, which is git-ignored and never part of a deploy.

// 0.5 Rebuild Windows agent installer (.exe) if NSIS is available.
//     The .exe is served by /api/v1/installations/agent-installer-exe.
//     macOS/Linux get zip downloads built live from source (no pre-build needed).
const nsisPath = 'C:\\Program Files (x86)\\NSIS\\makensis.exe';
if (existsSync(nsisPath)) {
  console.log('• Building Windows agent installer (NSIS)…');
  // Read server URL from .env on the remote host — bake it into the installer
  const serverUrlResult = spawnSync('bash', ['-c',
    `${SSH} "grep '^PORT=' ${DIR}/.env | cut -d= -f2 || echo 8787"`
  ], { cwd: root, encoding: 'utf8' });
  const port = (serverUrlResult.stdout || '8787').trim();
  const installerServerUrl = `http://${HOST}:${port}`;
  // Read enroll secret from remote .env
  const secretResult = spawnSync('bash', ['-c',
    `${SSH} "grep '^ENROLL_SECRET=' ${DIR}/.env | cut -d= -f2 || echo dev-enroll-secret-change-me"`
  ], { cwd: root, encoding: 'utf8' });
  const enrollSecret = (secretResult.stdout || 'dev-enroll-secret-change-me').trim();

  // Prepare build dir with agent source + Node.js
  const installerDir = resolve(root, 'agent/installer');
  const buildDir = resolve(installerDir, 'build');
  // Agent source
  sh(`mkdir -p "${buildDir}/agent/src" && cp -r agent/src/* "${buildDir}/agent/src/" && cp agent/package.json "${buildDir}/agent/"`);
  // Check if Node.js is already downloaded
  if (!existsSync(resolve(buildDir, 'node/node.exe'))) {
    console.log('  (downloading portable Node.js for bundling — first time only)');
    sh(`cd "${buildDir}" && powershell -NoProfile -Command "Invoke-WebRequest -Uri 'https://nodejs.org/dist/v22.15.0/node-v22.15.0-win-x64.zip' -OutFile node.zip" && powershell -NoProfile -Command "Expand-Archive -Path node.zip -DestinationPath . -Force" && mkdir -p node && cp -r node-v22.15.0-win-x64/* node/ && rm -rf node-v22.15.0-win-x64 node.zip`);
  }
  // Build .exe
  const nsisResult = spawnSync(nsisPath, [
    `-DSERVER_URL=${installerServerUrl}`,
    `-DENROLL_SECRET=${enrollSecret}`,
    `-DBUILD_DIR=${buildDir}`,
    resolve(installerDir, 'cloudfuze-agent.nsi'),
  ], { cwd: installerDir, stdio: 'inherit' });
  if (nsisResult.status === 0) {
    console.log('  ✓ Windows installer built');
  } else {
    console.warn('  ⚠ NSIS build failed — Windows .exe download will be unavailable');
  }
} else {
  console.log('• Skipping Windows installer (NSIS not installed — install from nsis.sourceforge.io)');
}

// 1. Build the frontend locally / on the runner (needs more RAM than the host).
console.log('• Building connect-ui (Vite)…');
// shell: true — on Windows the executable is npm.cmd, and spawnSync without a shell
// cannot resolve a bare "npm": it returns status null with error ENOENT, which this
// script reported as "connect-ui build failed (exit null)". That reads as a compile
// error and sent us looking at the frontend, when the build had never been started.
// Every other spawn here goes through `bash -c`; this was the one that did not.
const buildResult = spawnSync('npm', ['--prefix', 'connect-ui', 'run', 'build'], {
  cwd: root, stdio: 'inherit', shell: true, env: { ...process.env, VITE_ADMIN_TOKEN: '' },
});
// Surface the spawn error itself, not just the exit code — an ENOENT here means the
// command never ran, which is a different problem from a build that failed.
if (buildResult.error) die(`could not start the connect-ui build: ${buildResult.error.code || buildResult.error.message}`);
if (buildResult.status !== 0) die(`connect-ui build failed (exit ${buildResult.status})`);
if (!existsSync(resolve(root, 'connect-ui/dist/index.html'))) die('connect-ui build produced no dist/index.html');

// 2. Stream source (incl. built dist, excl. node_modules) to the host.
//    NOTE: .env is intentionally NOT shipped, and we delete everything in the
//    remote dir EXCEPT .env so the server's secrets survive every deploy.
console.log('• Shipping source to host (preserving server .env)…');
const excludes = "--exclude='*/node_modules' --exclude='*/.vite' --exclude='*/coverage' --exclude='*/build' --exclude='*/out'";
sh(`tar czf - ${excludes} agent server connect-ui browser-extension scripts sdk-js docker-compose.yml .dockerignore ` +
   `| ${SSH} "mkdir -p ${DIR} && find ${DIR} -mindepth 1 -maxdepth 1 ! -name .env -exec rm -rf {} + && tar xzf - -C ${DIR}"`);

// 3. Build images natively on the host (sequential — small box) and bring up.
console.log('• Building images on host + starting stack…');
sh(`${SSH} "cd ${DIR} && docker compose build server && docker compose build connect-ui && docker compose up -d"`);

// 4. Health check over the public endpoint.
console.log('• Health check…');
let ok = false;
for (let i = 1; i <= 15; i++) {
  const r = spawnSync('bash', ['-c', `curl -s -m 10 -o /dev/null -w '%{http_code}' http://${HOST}:8787/api/v1/health`], { encoding: 'utf8' });
  if (r.stdout.trim() === '200') { ok = true; break; }
  spawnSync('bash', ['-c', 'sleep 3']);
}
if (!ok) die(`server did not pass health check at http://${HOST}:8787/api/v1/health`);

console.log(`\n✓ Deploy complete — live:`);
console.log(`    API        http://${HOST}:8787/api/v1/health`);
console.log(`    connect-ui http://${HOST}:3000/CloudFuze/\n`);
