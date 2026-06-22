// Re-run only the desktop hook injector, using the credentials saved by a
// previous `npm run scan` enrollment. Skips OS monitor, report upload, etc.
//
// Usage: node scripts/inject-only.mjs
//
// Closes nothing — if Claude / Cursor / ChatGPT are currently running, their
// asars are locked and injection will be reported as failed for those apps.
// Close the app, re-run.

import { loadCredentials } from '../src/util/credentials.js';
import { runInjector, HOOK_VERSION } from '../src/desktop_injector/index.js';
import { createLogger } from '../src/util/logger.js';

const log = createLogger({ level: 'info' });
log.info(`inject-only: hook v${HOOK_VERSION}`);

const creds = await loadCredentials();
if (!creds?.token) {
  log.error('No credentials. Run `npm run scan -- --server <url> --enroll-secret <secret>` first.');
  process.exit(2);
}
log.info(`Using server ${creds.serverUrl}, machineId ${creds.machineId.slice(0, 8)}…`);

const findings = await runInjector({
  platform: process.platform,
  serverUrl: creds.serverUrl,
  token: creds.token,
  log: log.child('desktop_injector'),
});

console.log('\n=== Injection results ===');
for (const f of findings) {
  const tag =
    f.hookStatus === 'injected'         ? 'OK    '
    : f.hookStatus === 'already_injected' ? 'SKIP  '
    : 'FAIL  ';
  console.log(`${tag} ${f.product.padEnd(20)} v${f.hookVersion}  ${f.hookStatus}${f.reason ? ' — ' + f.reason : ''}`);
}
console.log('');
console.log(`${findings.length} app(s) processed.`);
