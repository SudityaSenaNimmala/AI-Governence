// End-to-end self-test for the MITM proxy.
//
// 1. Stands up a fake "origin" HTTPS server on 127.0.0.1:9876 (acts as e.g.
//    api.openai.com — it echoes the request body in JSON).
// 2. Loads the CloudFuze CA and starts the proxy on 127.0.0.1:8443.
// 3. Adds 127.0.0.1 to the proxy's intercept whitelist for this test only
//    (we mutate the imported Set; no source edit).
// 4. Sends two requests through the proxy:
//      a) clean payload → expect 200 echo
//      b) payload containing an AWS access key → expect 451 block + governance event
// 5. Asserts both outcomes, tears down, exits 0.
//
// Does NOT activate the system proxy. Does NOT touch real AI vendors.

import { createServer as createHttpsServer } from 'node:https';
import { createSecureContext, connect as tlsConnect } from 'node:tls';
import { connect as netConnect } from 'node:net';
import { loadOrCreateCA, mintLeafCert } from '../src/proxy/ca.js';
import { startProxy } from '../src/proxy/proxy-server.js';
import { INTERCEPT_DOMAINS, ALWAYS_INTERCEPT } from '../src/proxy/whitelist.js';

const log = {
  info: (...a) => console.log('[ I]', ...a),
  warn: (...a) => console.log('[W ]', ...a),
};

// Capture reporter events for assertions.
const capturedEvents = [];
const fakeReporter = { enqueue: (e) => capturedEvents.push(e) };

console.log('-- step 1: load CA --');
const ca = await loadOrCreateCA({ log });

console.log('-- step 2: bring up fake origin on 127.0.0.1:9876 --');
const originLeaf = mintLeafCert({ ca, hosts: ['127.0.0.1'] });
const origin = createHttpsServer(
  { cert: originLeaf.certPem, key: originLeaf.keyPem },
  (req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const out = JSON.stringify({ echoed: body, path: req.url });
      // Fixed Content-Length so the test client doesn't need to dechunk.
      res.writeHead(200, {
        'content-type':   'application/json',
        'content-length': Buffer.byteLength(out),
        'connection':     'close',
      });
      res.end(out);
    });
  }
);
await new Promise((resolve) => origin.listen(9876, '127.0.0.1', resolve));

// Add 127.0.0.1 to BOTH the intercept whitelist AND the always-intercept set
// so the test bypasses the process-gated branch (which requires a known AI
// desktop process — node.exe isn't one).
INTERCEPT_DOMAINS.push('127.0.0.1');
ALWAYS_INTERCEPT.add('127.0.0.1');

console.log('-- step 3: bring up proxy on 127.0.0.1:8443 --');
// upstreamTlsOptions: the proxy's outbound https.request to our fake origin
// would normally fail TLS verification (origin's cert is signed by the CloudFuze
// CA, not a public CA). In real use the proxy talks to chatgpt.com / api.openai.com
// with public CA-signed certs, so this option stays unset in production.
const { stop: stopProxy } = await startProxy({
  ca, reporter: fakeReporter, log, port: 8443,
  upstreamTlsOptions: { ca: ca.caCertPem, checkServerIdentity: () => undefined },
});

console.log('-- step 4: tunnel a CLEAN request through proxy → fake origin --');
const cleanRes = await httpsThroughProxy({
  proxyHost: '127.0.0.1', proxyPort: 8443,
  tunnelHost: '127.0.0.1', tunnelPort: 9876,
  method: 'POST', path: '/v1/chat',
  body: '{"prompt":"hello, this is fine"}',
  caPem: ca.caCertPem,
});
if (cleanRes.statusCode !== 200) {
  console.error(`FAIL: clean request expected 200, got ${cleanRes.statusCode} body=${cleanRes.body}`);
  process.exit(1);
}
const cleanEcho = JSON.parse(cleanRes.body);
if (!cleanEcho.echoed.includes('hello, this is fine')) {
  console.error(`FAIL: clean request did not echo body, got: ${cleanRes.body}`);
  process.exit(1);
}
console.log('   PASS: 200 echo round-trip works');

console.log('-- step 5: tunnel a DIRTY request (AWS access key) — expect 451 block --');
const dirtyPayload = '{"prompt":"my AWS key is AKIAIOSFODNN7EXAMPLE for reference"}';
const dirtyRes = await httpsThroughProxy({
  proxyHost: '127.0.0.1', proxyPort: 8443,
  tunnelHost: '127.0.0.1', tunnelPort: 9876,
  method: 'POST', path: '/v1/chat',
  body: dirtyPayload,
  caPem: ca.caCertPem,
});
if (dirtyRes.statusCode !== 451) {
  console.error(`FAIL: dirty request expected 451, got ${dirtyRes.statusCode} body=${dirtyRes.body}`);
  process.exit(1);
}
const blockBody = JSON.parse(dirtyRes.body);
if (blockBody.error !== 'blocked_by_cloudfuze') {
  console.error(`FAIL: 451 body missing blocked_by_cloudfuze sentinel: ${dirtyRes.body}`);
  process.exit(1);
}
if (!blockBody.matches?.some((m) => m.pattern === 'aws-access-key')) {
  console.error(`FAIL: 451 body did not flag aws-access-key: ${dirtyRes.body}`);
  process.exit(1);
}
console.log(`   PASS: 451 block, patterns=${blockBody.matches.map((m) => m.pattern).join(',')}`);

console.log('-- step 6: verify enforcement_block governance event was emitted --');
const blockEv = capturedEvents.find((e) => e.kind === 'enforcement_block');
if (!blockEv) {
  console.error(`FAIL: no enforcement_block in captured events. Saw: ${JSON.stringify(capturedEvents)}`);
  process.exit(1);
}
if (blockEv.mechanism !== 'proxy_block') {
  console.error(`FAIL: enforcement_block missing mechanism=proxy_block. Got: ${JSON.stringify(blockEv)}`);
  process.exit(1);
}
console.log(`   PASS: governance event has mechanism=proxy_block, service=${blockEv.service}, severity=${blockEv.highest_severity}`);

console.log('-- step 7: tear down --');
await stopProxy();
await new Promise((resolve) => origin.close(resolve));

console.log('\nALL PROXY ROUND-TRIP CHECKS PASS');

// ---- helpers ----

/**
 * Open a CONNECT tunnel through proxyHost:proxyPort to tunnelHost:tunnelPort,
 * do a TLS handshake (trusting caPem), send one HTTPS request, return
 * { statusCode, body }.
 */
function httpsThroughProxy({ proxyHost, proxyPort, tunnelHost, tunnelPort, method, path, body, caPem }) {
  return new Promise((resolve, reject) => {
    const sock = netConnect(proxyPort, proxyHost, () => {
      sock.write(`CONNECT ${tunnelHost}:${tunnelPort} HTTP/1.1\r\nHost: ${tunnelHost}:${tunnelPort}\r\n\r\n`);
    });
    let buf = Buffer.alloc(0);
    const onConnectResp = (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      const idx = buf.indexOf('\r\n\r\n');
      if (idx < 0) return;
      const head = buf.slice(0, idx).toString('utf8');
      if (!/HTTP\/1\.1 200/.test(head)) {
        sock.destroy();
        return reject(new Error(`CONNECT failed: ${head}`));
      }
      sock.removeListener('data', onConnectResp);
      // Now upgrade to TLS, trusting our CA, with SNI=tunnelHost.
      const tlsSock = tlsConnect({
        socket: sock,
        servername: tunnelHost,
        ca: caPem,
      }, () => {
        const req = `${method} ${path} HTTP/1.1\r\nHost: ${tunnelHost}\r\nContent-Length: ${Buffer.byteLength(body)}\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n${body}`;
        tlsSock.write(req);
      });
      let resBuf = Buffer.alloc(0);
      tlsSock.on('data', (d) => { resBuf = Buffer.concat([resBuf, d]); });
      tlsSock.on('end', () => {
        const text = resBuf.toString('utf8');
        const sep = text.indexOf('\r\n\r\n');
        const head2 = sep > 0 ? text.slice(0, sep) : text;
        const body2 = sep > 0 ? text.slice(sep + 4) : '';
        const m = head2.match(/HTTP\/1\.1 (\d+)/);
        resolve({ statusCode: m ? Number(m[1]) : 0, body: body2, headers: head2 });
      });
      tlsSock.on('error', reject);
    };
    sock.on('data', onConnectResp);
    sock.on('error', reject);
  });
}
