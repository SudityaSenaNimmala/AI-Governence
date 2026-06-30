// Manual verification for the MCP guard: sends a benign and a sensitive
// tools/call through cfai-mcp-guard (wrapping a harmless mock MCP server) and
// prints, for each, whether the host would receive the server's result
// (ALLOWED) or a CloudFuze policy error (BLOCKED). If agent credentials exist,
// the guard also reports blocks to the governance server, so they show up in
// the dashboard under AI Activity → Sensitive prompts.
//
//   node scripts/mcp-guard-check.mjs
//
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const AGENT = join(dirname(fileURLToPath(import.meta.url)), '..');
const GUARD = join(AGENT, 'src', 'mcp_guard', 'index.js');
const MOCK = join(AGENT, 'tests', 'fixtures', 'mock-mcp-server.mjs');

let serverUrl = '', token = '';
try {
  const c = JSON.parse(readFileSync(join(homedir(), '.cloudfuze-aigov', 'credentials.json'), 'utf8'));
  serverUrl = c.serverUrl || ''; token = c.token || '';
} catch { /* no creds — enforcement still works, just no dashboard reporting */ }

// The probes: each is a tools/call the host might send to a filesystem MCP.
const PROBES = [
  { id: 11, label: 'benign note',         args: { path: 'notes.txt',  content: 'remember to buy milk' } },
  { id: 12, label: 'prompt with SSN',     args: { path: 'case.txt',   content: 'customer SSN is 123-45-6789' } },
  { id: 13, label: 'prompt with API key', args: { path: 'cfg.txt',    content: 'OPENAI_KEY=sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAA' } },
  { id: 14, label: 'read a .env file',    args: { path: 'C:\\app\\.env' } },
  { id: 15, label: 'upload customers.csv',args: { path: 'C:\\data\\customers.csv' } },
];

const child = spawn(process.execPath, [GUARD, '--', process.execPath, MOCK], {
  stdio: ['pipe', 'pipe', 'inherit'],
  env: { ...process.env, CFAI_GUARD_SERVER: serverUrl, CFAI_GUARD_TOKEN: token, CFAI_GUARD_SERVERNAME: 'filesystem', CFAI_GUARD_THRESHOLD: 'high' },
});

const labelOf = new Map(PROBES.map((p) => [p.id, p.label]));
let buf = '';
child.stdout.on('data', (d) => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    const m = JSON.parse(line);
    if (m.id === 0) continue; // initialize ack
    const label = (labelOf.get(m.id) || m.id).padEnd(22);
    if (m.error) console.log(`  ❌ BLOCKED  ${label} → ${m.error.data?.patterns?.join(', ')}`);
    else         console.log(`  ✅ ALLOWED  ${label} → reached server`);
  }
});

console.log(`\nMCP guard check  (reporting: ${token ? serverUrl : 'off — no creds'})\n`);
const send = (o) => child.stdin.write(JSON.stringify(o) + '\n');
send({ jsonrpc: '2.0', id: 0, method: 'initialize', params: {} });
for (const p of PROBES) send({ jsonrpc: '2.0', id: p.id, method: 'tools/call', params: { name: 'write_file', arguments: p.args } });

setTimeout(() => { console.log('\n(blocks above were reported to the dashboard if reporting is on)\n'); child.kill(); process.exit(0); }, 2500);
