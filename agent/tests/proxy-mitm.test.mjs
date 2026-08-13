// Regression tests for the HTTPS-MITM intercept path (agent/src/proxy).
//
// Context: mitmTunnel() is a module-level function, but the inner request
// handler it installs used to reference `vault` and `_tokenizePatterns` —
// both declared inside startProxy(). Nothing in mitmTunnel's scope chain
// reaches startProxy's locals, so EVERY intercepted HTTPS request threw
//   ReferenceError: vault is not defined
// the moment the first inner HTTP request was parsed off the TLS stream.
//
// These tests exercise the exact closure that threw, without TLS, certs or
// any off-box network: serveInnerHttp() takes the already-established duplex
// stream, so we hand it one half of a loopback socket pair and speak raw
// HTTP/1.1 into the other half.
//
// Both assertions below are only reachable if `vault` and `tokenizePatterns`
// are in scope where the handler builds its hooks object.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';

import { serveInnerHttp } from '../src/proxy/proxy-server.js';

const SECRET_BODY = JSON.stringify({
  model: 'gpt-4o',
  messages: [{ role: 'user', content: 'deploy with sk-proj-AAAAAAAAAAAAAAAAAAAAAAAAAAAA please' }],
});

/**
 * Loopback socket pair. Returns { client, server } — two connected sockets,
 * no listener left behind. 127.0.0.1 only; nothing leaves the machine.
 */
function socketPair() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      let server = null;
      let client = null;
      const done = () => {
        if (server && client) {
          srv.close();
          resolve({ client, server });
        }
      };
      srv.once('connection', (s) => { server = s; done(); });
      client = net.connect(port, '127.0.0.1', () => done());
      client.on('error', reject);
    });
  });
}

/** Write a raw HTTP/1.1 request and read the response head (+ body when Content-Length says so). */
function rawExchange(socket, raw, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    let buf = '';
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`no HTTP response within ${timeoutMs}ms — got ${JSON.stringify(buf.slice(0, 200))}`));
    }, timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      socket.off('data', onData);
      socket.off('error', onErr);
      socket.off('close', onClose);
    };
    const tryResolve = () => {
      const idx = buf.indexOf('\r\n\r\n');
      if (idx < 0) return false;
      const head = buf.slice(0, idx);
      const body = buf.slice(idx + 4);
      const lines = head.split('\r\n');
      const status = Number(lines[0].split(' ')[1]);
      const headers = {};
      for (const line of lines.slice(1)) {
        const c = line.indexOf(':');
        if (c > 0) headers[line.slice(0, c).trim().toLowerCase()] = line.slice(c + 1).trim();
      }
      const expect = headers['content-length'] != null ? Number(headers['content-length']) : 0;
      if (Buffer.byteLength(body, 'utf8') < expect) return false;   // body still arriving
      cleanup();
      resolve({ status, headers, body });
      return true;
    };
    const onData = (c) => { buf += c.toString('utf8'); tryResolve(); };
    const onErr = (e) => { cleanup(); reject(e); };
    const onClose = () => { if (!tryResolve()) { cleanup(); reject(new Error('socket closed before a response: ' + JSON.stringify(buf.slice(0, 200)))); } };
    socket.on('data', onData);
    socket.on('error', onErr);
    socket.on('close', onClose);
    socket.write(raw);
  });
}

function httpPost(host, path, body) {
  return `POST ${path} HTTP/1.1\r\nHost: ${host}\r\ncontent-type: application/json\r\n`
    + `content-length: ${Buffer.byteLength(body, 'utf8')}\r\nconnection: close\r\n\r\n${body}`;
}

/** A port nothing is listening on — makes the forward-to-origin path fail fast, locally. */
async function deadPort() {
  const srv = net.createServer();
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const { port } = srv.address();
  await new Promise((r) => srv.close(r));
  return port;
}

/**
 * Stand up serveInnerHttp over a loopback socket pair and return the client
 * half. Sockets are torn down via t.after() so a FAILING assertion (or an
 * exception thrown inside the handler) can never leave the test file hanging
 * on an open handle.
 */
async function withInnerServer(t, opts) {
  const { client, server } = await socketPair();
  t.after(() => { try { client.destroy(); } catch {} try { server.destroy(); } catch {} });
  serveInnerHttp({ socket: server, ...opts });
  return client;
}

test('intercepted request with a blockable secret returns 451 (no ReferenceError on vault/tokenizePatterns)', async (t) => {
  const enqueued = [];
  const warnings = [];
  const log = { info() {}, warn: (m) => warnings.push(String(m)) };

  const client = await withInnerServer(t, {
    reqHost: 'api.openai.com',
    reqPort: 443,
    reporter: { enqueue: (e) => enqueued.push(e) },
    log,
    upstreamTlsOptions: null,
    onApiCall: null,
    peerPort: 51234,
    vault: { size: 0, create: () => 'TOKEN', hasTokens: () => false, restore: (s) => s },
    tokenizePatterns: new Set(),
  });

  const res = await rawExchange(client, httpPost('api.openai.com', '/v1/chat/completions', SECRET_BODY));

  assert.equal(res.status, 451, 'the secret must be blocked at the proxy');
  assert.equal(res.headers['x-cloudfuze-block'], 'true');
  assert.equal(JSON.parse(res.body).error, 'blocked_by_cloudfuze');

  assert.equal(enqueued.length, 1);
  assert.equal(enqueued[0].kind, 'enforcement_block');
  assert.equal(enqueued[0].mechanism, 'proxy_block');
  assert.deepEqual(enqueued[0].matches.map((m) => m.pattern), ['openai-api-key']);
  // A ReferenceError inside the handler would surface here as a rejected
  // promise / no response at all, so an explicit check keeps the intent clear.
  assert.equal(warnings.filter((w) => /is not defined/.test(w)).length, 0);
});

test('the vault and the tokenize set reach the intercept handler', async (t) => {
  // tokenizePatterns moves 'openai-api-key' from the block path to the
  // tokenize path. The tokenize path is the ONLY code that touches
  // hooks.vault, and it only runs when the vault is truthy — so reaching it
  // proves both values were threaded from the caller into the handler.
  const port = await deadPort();
  const warnings = [];
  const vaultCalls = [];

  const client = await withInnerServer(t, {
    reqHost: '127.0.0.1',                 // forward attempt stays on loopback
    reqPort: port,                        // …and fails fast: nothing listening
    reporter: { enqueue: () => {} },
    log: { info() {}, warn: (m) => warnings.push(String(m)) },
    upstreamTlsOptions: null,
    onApiCall: null,
    peerPort: 51235,
    vault: {
      size: 0,
      create: (value, pattern) => { vaultCalls.push(pattern); return 'CFTOK_1'; },
      hasTokens: () => false,
      restore: (s) => s,
    },
    tokenizePatterns: new Set(['openai-api-key']),
  });

  // Non-JSON body: the tokenizer's JSON.parse throws, which logs a warning we
  // can assert on, and the request is forwarded unmodified afterwards.
  const res = await rawExchange(client, httpPost('127.0.0.1', '/v1/chat/completions', 'raw text sk-proj-AAAAAAAAAAAAAAAAAAAAAAAAAAAA'));

  assert.equal(res.status, 502, 'forward to the dead local port fails → 502');
  assert.equal(
    warnings.some((w) => /tokenization parse error/.test(w)),
    true,
    'the tokenize path ran, which requires hooks.vault + hooks.tokenizePatterns',
  );
  assert.equal(warnings.some((w) => /is not defined/.test(w)), false);
});

test('a JSON body whose secret is configured for tokenization gets masked before forwarding', async (t) => {
  const port = await deadPort();
  const created = [];

  const client = await withInnerServer(t, {
    reqHost: '127.0.0.1',
    reqPort: port,
    reporter: { enqueue: () => {} },
    log: { info() {}, warn() {} },
    upstreamTlsOptions: null,
    onApiCall: null,
    peerPort: 51236,
    vault: {
      size: 0,
      create: (value, pattern) => { created.push({ value, pattern }); return 'CFTOK_ABC'; },
      hasTokens: () => false,
      restore: (s) => s,
    },
    tokenizePatterns: new Set(['openai-api-key']),
  });

  const res = await rawExchange(client, httpPost('127.0.0.1', '/v1/chat/completions', SECRET_BODY));

  assert.equal(res.status, 502);
  assert.equal(created.length, 1, 'the vault minted a token for the matched secret');
  assert.equal(created[0].pattern, 'openai-api-key');
  assert.match(created[0].value, /^sk-proj-/);
});
