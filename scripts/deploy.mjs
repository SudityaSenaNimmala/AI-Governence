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

// 1. Build the frontend locally / on the runner (needs more RAM than the host).
console.log('• Building connect-ui (Vite)…');
sh('npm --prefix connect-ui run build');
if (!existsSync(resolve(root, 'connect-ui/dist/index.html'))) die('connect-ui build produced no dist/index.html');

// 2. Stream source (incl. built dist, excl. node_modules) to the host.
//    NOTE: .env is intentionally NOT shipped, and we delete everything in the
//    remote dir EXCEPT .env so the server's secrets survive every deploy.
console.log('• Shipping source to host (preserving server .env)…');
const excludes = "--exclude='*/node_modules' --exclude='*/.vite' --exclude='*/coverage' --exclude='*/build' --exclude='*/out'";
sh(`tar czf - ${excludes} agent server connect-ui docker-compose.yml .dockerignore ` +
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
