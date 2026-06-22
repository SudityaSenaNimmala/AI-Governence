// Verify the long-lived resolver actually populates a map of live connections.
import { start, stop, getProcessByLocalPort } from '../src/proxy/process-resolver-win32.js';
import { spawn } from 'node:child_process';

const log = {
  info: (...a) => console.log('[I]', ...a),
  warn: (...a) => console.log('[W]', ...a),
};

const t0 = Date.now();
start({ log });
console.log('waiting up to 25s for first snapshot...');

// Poll until we see a non-empty map or timeout.
const deadline = t0 + 25_000;
let sample = null;
while (Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 500));
  // Grab a real established port to probe with.
  const ns = await new Promise((res, rej) => {
    const c = spawn('netstat', ['-ano']);
    let out = '';
    c.stdout.on('data', (d) => { out += String(d); });
    c.on('exit', () => res(out));
    c.on('error', rej);
  });
  // Find a line with a non-8443 ephemeral port (so we're testing the client side)
  const m = ns.split(/\r?\n/)
    .map((l) => l.match(/TCP\s+\d+\.\d+\.\d+\.\d+:(\d+)\s+\S+\s+ESTABLISHED\s+(\d+)/))
    .find((m) => m && Number(m[1]) > 10000);
  if (!m) continue;
  const port = Number(m[1]);
  const got = getProcessByLocalPort(port);
  if (got && got.name) {
    sample = { port, ...got, elapsedMs: Date.now() - t0 };
    break;
  }
}

if (sample) {
  console.log(`PASS — first hit after ${sample.elapsedMs}ms — port=${sample.port} pid=${sample.pid} name=${sample.name}`);
  stop();
  process.exit(0);
}
console.log('FAIL — no hit within 25s. Resolver did not populate cache.');
stop();
process.exit(1);
