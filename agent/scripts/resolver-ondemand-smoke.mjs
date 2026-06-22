// Verify the on-demand `lookup <port>` path actually returns data.
import { start, stop, getProcessByLocalPort, resolveOnDemand } from '../src/proxy/process-resolver-win32.js';
import { spawn } from 'node:child_process';

const log = {
  info: (...a) => console.log('[I]', ...a),
  warn: (...a) => console.log('[W]', ...a),
};
start({ log });

console.log('waiting up to 25s for helper ready + first snapshot...');
let firstSnapHere = Date.now();
while (Date.now() - firstSnapHere < 25_000) {
  await new Promise((r) => setTimeout(r, 500));
  if (getProcessByLocalPort(8443)) break;     // proxy listens on 8443 — should appear in snapshot
}
console.log('snapshot has 8443 ->', getProcessByLocalPort(8443));

// Pick an arbitrary established port that's NOT in the snapshot cache and try on-demand.
const ns = await new Promise((res, rej) => {
  const c = spawn('netstat', ['-ano']);
  let out = '';
  c.stdout.on('data', (d) => { out += String(d); });
  c.on('exit', () => res(out));
  c.on('error', rej);
});
const candidates = [...ns.split(/\r?\n/)]
  .map((l) => l.match(/TCP\s+\d+\.\d+\.\d+\.\d+:(\d+)\s+\S+\s+ESTABLISHED\s+(\d+)/))
  .filter(Boolean)
  .map((m) => ({ port: Number(m[1]), pid: Number(m[2]) }))
  .filter((c) => c.port > 10000);

let testedCount = 0;
for (const cand of candidates.slice(0, 5)) {
  const tStart = Date.now();
  const r = await resolveOnDemand(cand.port, 1000);
  const elapsed = Date.now() - tStart;
  console.log(`port ${cand.port} (netstat says pid=${cand.pid}): resolveOnDemand returned`, r, `in ${elapsed}ms`);
  testedCount++;
}

console.log(`tested ${testedCount} on-demand lookups`);
stop();
