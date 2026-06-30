import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { inspectMessage, shouldBlock, blockResponse, BLOCK_ERROR_CODE } from '../src/mcp_guard/guard.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GUARD = join(__dirname, '..', 'src', 'mcp_guard', 'index.js');
const MOCK = join(__dirname, 'fixtures', 'mock-mcp-server.mjs');

// ── unit: core decision logic ────────────────────────────────────────────────

test('benign tools/call is not flagged', () => {
  const v = inspectMessage({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'write_file', arguments: { path: 'notes.txt', content: 'hello world' } } });
  assert.equal(v, null);
});

test('SSN in tool args → critical', () => {
  const v = inspectMessage({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'write_file', arguments: { content: 'employee ssn is 123-45-6789' } } });
  assert.ok(v);
  assert.equal(v.highestSeverity, 'critical');
  assert.ok(v.matches.some((m) => m.pattern === 'us-ssn'));
  assert.equal(shouldBlock(v, 'high'), true);
});

test('API key in tool args → blocked at high threshold', () => {
  const v = inspectMessage({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'post', arguments: { body: 'key=sk-ant-api03-abcdefghij1234567890ABCDEFGHIJ' } } });
  assert.ok(v);
  assert.equal(shouldBlock(v, 'high'), true);
});

test('sensitive file path (.env) → blocked via filename classifier', () => {
  const v = inspectMessage({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'read_file', arguments: { path: 'C:\\app\\.env' } } });
  assert.ok(v);
  assert.ok(v.matches.some((m) => m.pattern.startsWith('file:')));
  assert.equal(shouldBlock(v, 'high'), true);
});

test('ordinary document path is not blocked at high threshold', () => {
  const v = inspectMessage({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'read_file', arguments: { path: 'C:\\docs\\readme.txt' } } });
  // readme.txt → plain_text/low, no content match → either null or low severity
  assert.equal(shouldBlock(v, 'high'), false);
});

test('non tools/call methods pass (inspect returns null)', () => {
  assert.equal(inspectMessage({ jsonrpc: '2.0', id: 1, method: 'tools/list' }), null);
  assert.equal(inspectMessage({ jsonrpc: '2.0', id: 0, method: 'initialize', params: {} }), null);
});

test('blockResponse echoes id and uses policy error code', () => {
  const v = inspectMessage({ jsonrpc: '2.0', id: 42, method: 'tools/call', params: { name: 'write_file', arguments: { content: '123-45-6789' } } });
  const r = blockResponse({ id: 42 }, v);
  assert.equal(r.id, 42);
  assert.equal(r.error.code, BLOCK_ERROR_CODE);
  assert.equal(r.error.data.blockedBy, 'cloudfuze-mcp-guard');
});

// ── integration: shim wrapping a real (mock) stdio server ────────────────────

test('end-to-end: sensitive call blocked, benign call reaches server', async () => {
  const child = spawn(process.execPath, [GUARD, '--', process.execPath, MOCK], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, CFAI_GUARD_THRESHOLD: 'high', CFAI_GUARD_SERVER: '', CFAI_GUARD_TOKEN: '' },
  });

  const responses = new Map();
  let stdoutBuf = '';
  const want = new Set([0, 1, 2, 3]);
  const done = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout waiting for responses; got ids ' + [...responses.keys()])), 10000);
    child.stdout.on('data', (d) => {
      stdoutBuf += d.toString('utf8');
      let i;
      while ((i = stdoutBuf.indexOf('\n')) >= 0) {
        const line = stdoutBuf.slice(0, i); stdoutBuf = stdoutBuf.slice(i + 1);
        if (!line.trim()) continue;
        let msg; try { msg = JSON.parse(line); } catch { continue; }
        if (msg.id !== undefined && msg.id !== null) responses.set(msg.id, msg);
        if ([...want].every((id) => responses.has(id))) { clearTimeout(timer); resolve(); }
      }
    });
    child.on('error', reject);
  });

  const send = (o) => child.stdin.write(JSON.stringify(o) + '\n');
  send({ jsonrpc: '2.0', id: 0, method: 'initialize', params: {} });
  send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'write_file', arguments: { path: 'notes.txt', content: 'just a normal note' } } });
  send({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'write_file', arguments: { path: 'leak.txt', content: 'customer ssn 123-45-6789' } } });
  send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'read_file', arguments: { path: 'C:\\app\\.env' } } });

  try {
    await done;
  } finally {
    child.kill();
  }

  // initialize handshake forwarded to the server
  assert.ok(responses.get(0).result?.serverInfo, 'initialize should reach the server');

  // benign call reached the mock server (server echoes which tool it got)
  assert.match(responses.get(2).result?.content?.[0]?.text || '', /server-received:write_file/);

  // sensitive content call was blocked by the guard, never reached the server
  assert.equal(responses.get(1).error?.code, BLOCK_ERROR_CODE);
  assert.equal(responses.get(1).error?.data?.blockedBy, 'cloudfuze-mcp-guard');

  // sensitive file path call was blocked too
  assert.equal(responses.get(3).error?.code, BLOCK_ERROR_CODE);
});
