// HTTPS MITM proxy.
//
// Listens on 127.0.0.1:8443. Handles three traffic shapes:
//
//   1. HTTP requests directly to the proxy (rare — browsers tunnel HTTPS via
//      CONNECT). Forwarded as-is unless the host is whitelisted, in which case
//      we scan the body.
//
//   2. CONNECT host:443 — for HTTPS. Two branches:
//        a) host is NOT in the whitelist  →  bridge raw sockets, no MITM.
//           The TLS handshake happens between client ↔ origin and we never
//           see plaintext. Zero cert-pinning risk for non-AI traffic.
//        b) host IS in the whitelist  →  TLS-terminate using a leaf cert
//           minted on the fly from our CA, then read inner HTTP requests
//           from the decrypted stream, scan, and either forward (https.request
//           to origin) or block (return 451).
//
//   3. WebSocket / HTTP/2 inside an intercepted TLS tunnel — passed through
//      transparently. Body scan is only attempted for plain HTTP/1.1 with a
//      reasonable Content-Length. Streaming responses (SSE) are passed through
//      untouched once the request has been allowed.
//
// Performance notes:
//   - Leaf certs are cached by host (Map). RSA-2048 keygen is ~150-300ms.
//   - Body scan is regex-based and runs at ~100MB/s on prompt-sized payloads
//     so latency impact is dominated by TLS handshake, not scanning.

import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { URL } from 'node:url';
import { isIntercepted, isAlwaysInterceptHost, isPinnedHost } from './whitelist.js';
import { mintLeafCert } from './ca.js';
import { scan } from '../os_monitor/classifier.js';
import { shouldSkipScan, blockableMatches, isBrowserProcess, isAiDesktopProcess } from './scan-policy.js';
import { getProcessByLocalPort, resolveOnDemand } from './process-resolver-win32.js';

const BODY_SCAN_MAX_BYTES = 2 * 1024 * 1024;     // 2MB — covers any normal prompt

// Hop-by-hop headers (RFC 7230 §6.1) — these are connection-specific and
// MUST be stripped when forwarding through a proxy. We also strip
// Content-Length because the proxy buffers the full body and resets it.
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade',
  'content-length',
]);

function stripHopByHop(headers) {
  const out = {};
  // Anything LISTED in the Connection: header is also hop-by-hop.
  const connHeaderRaw = headers.connection;
  const connNamed = new Set();
  if (typeof connHeaderRaw === 'string') {
    for (const name of connHeaderRaw.split(',')) connNamed.add(name.trim().toLowerCase());
  }
  for (const [k, v] of Object.entries(headers)) {
    const lk = k.toLowerCase();
    if (HOP_BY_HOP.has(lk)) continue;
    if (connNamed.has(lk)) continue;
    out[k] = v;
  }
  return out;
}

const BLOCK_BODY = (matches) => JSON.stringify({
  error: 'blocked_by_cloudfuze',
  message: 'CloudFuze AI Governance blocked this request because it contains sensitive data.',
  matches: matches.map((m) => ({ pattern: m.pattern, severity: m.severity, count: m.count })),
  remediation: 'Remove the highlighted information and retry. Contact security@cloudfuze.com for false positives.',
});

export async function startProxy({ ca, reporter, log, port = 8443, host = '127.0.0.1', upstreamTlsOptions = null, onApiCall = null, alwaysIntercept = false }) {
  // onApiCall is the server-monitor hook. When provided, every successful
  // intercepted request gets its response body teed (capped) and the hook
  // fires once the response ends. The hook receives:
  //   { host, path, method, requestHeaders, requestBody, responseStatus,
  //     responseHeaders, responseBody, responseTruncated, startedAt,
  //     durationMs, peerPort }
  // It's invoked best-effort and exceptions are swallowed — never affects
  // the request flow.
  //
  // alwaysIntercept=true forces the CONNECT decision to INTERCEPT for any
  // host in the intercept list, skipping the process-name gating used on
  // desktop (server-side has no browsers to worry about).
  const leafCache = new Map();   // host → SecureContext

  function secureContextFor(reqHost) {
    let ctx = leafCache.get(reqHost);
    if (ctx) return ctx;
    const { certPem, keyPem } = mintLeafCert({ ca, hosts: [reqHost] });
    ctx = tls.createSecureContext({ cert: certPem, key: keyPem });
    leafCache.set(reqHost, ctx);
    return ctx;
  }

  // --- Plain HTTP requests TO the proxy (direct proxy use, no CONNECT). ---
  const server = http.createServer(async (req, res) => {
    const target = parseProxiedUrl(req.url, req.headers.host);
    if (!target) {
      res.writeHead(400, { 'content-type': 'text/plain' });
      return res.end('Bad proxy request');
    }
    if (isIntercepted(target.hostname)) {
      return handleInterceptedHttpRequest(req, res, target, reporter, log, upstreamTlsOptions, { onApiCall, peerPort: req.socket?.remotePort });
    }
    return forwardPlainHttp(req, res, target);
  });

  // --- CONNECT for HTTPS tunnels. ---
  //
  // Decision tree:
  //   1. Host NOT in whitelist                        → bridge (no MITM, ever)
  //   2. Host in ALWAYS_INTERCEPT (API endpoints)     → INTERCEPT (any process)
  //   3. Host in whitelist but NOT always-intercept
  //      (web frontends: chatgpt.com, claude.ai, ...) → INTERCEPT only if the
  //                                                     source process is a
  //                                                     known AI desktop app.
  //                                                     Otherwise bridge —
  //                                                     so browsers don't
  //                                                     trip Cloudflare or
  //                                                     duplicate the
  //                                                     extension's work.
  //
  // Lookup is sync (snapshot cache) with an async on-demand fallback. With
  // the P/Invoke TCP-table backend the on-demand path is ~5-50ms — fast
  // enough to make the CONNECT decision wait briefly without breaking
  // browser UX. Cache misses for web frontends therefore reliably pick up
  // the source process before deciding.
  server.on('connect', async (req, clientSocket, head) => {
    const [reqHost, portStr] = req.url.split(':');
    const reqPort = parseInt(portStr, 10) || 443;

    let decision = 'bridge';
    let reason = '';

    if (isPinnedHost(reqHost)) {
      // Vendor pins their cert — never MITM. Bridge silently, no retry loop.
      decision = 'bridge';
      reason = ' (pinned)';
    } else if (isIntercepted(reqHost)) {
      if (alwaysIntercept || isAlwaysInterceptHost(reqHost)) {
        decision = 'INTERCEPT';
        reason = alwaysIntercept ? ' (server-mode always-intercept)' : ' (API endpoint)';
      } else {
        // Web frontend — process-gated. (Desktop only — server mode never hits
        // this branch because alwaysIntercept=true above.)
        const peerPort = clientSocket.remotePort;
        let proc = peerPort ? getProcessByLocalPort(peerPort) : null;
        if (!proc && peerPort) {
          // Cache miss → on-demand point query against the helper. With the
          // fast GetExtendedTcpTable backend this is ~5-50ms.
          proc = await resolveOnDemand(peerPort, 200);
        }
        if (proc && isAiDesktopProcess(proc.name)) {
          decision = 'INTERCEPT';
          reason = ` (AI desktop: ${proc.name})`;
        } else if (proc && isBrowserProcess(proc.name)) {
          reason = ` (browser: ${proc.name})`;
        } else if (proc) {
          reason = ` (process: ${proc.name})`;
        } else {
          reason = ` (process: unknown@${peerPort})`;
        }
      }
    }
    log?.info?.(`proxy: CONNECT ${reqHost}:${reqPort} ${decision}${reason}`);

    if (decision === 'bridge') {
      return bridgeRawTls(clientSocket, head, reqHost, reqPort, log);
    }
    return mitmTunnel({ clientSocket, head, reqHost, reqPort, secureContextFor, reporter, log, upstreamTlsOptions, onApiCall, peerPort: clientSocket.remotePort });
  });

  // --- Errors at the outer-server layer (rare; per-request errors are caught inline). ---
  server.on('clientError', (err, sock) => {
    log?.warn?.(`proxy: clientError ${err?.code || err?.message}`);
    try { sock.destroy(); } catch {}
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });
  log?.info?.(`proxy: listening on ${host}:${port}`);
  return {
    server,
    stop: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

// ---- HTTPS MITM tunnel ----

function mitmTunnel({ clientSocket, head, reqHost, reqPort, secureContextFor, reporter, log, upstreamTlsOptions, onApiCall, peerPort }) {
  clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');

  const tlsServer = new tls.TLSSocket(clientSocket, {
    isServer: true,
    secureContext: secureContextFor(reqHost),
  });
  if (head && head.length) tlsServer.push(head);

  tlsServer.on('error', (err) => {
    log?.warn?.(`proxy: tlsServer error for ${reqHost}: ${err?.code || err?.message}`);
    try { clientSocket.destroy(); } catch {}
  });

  // Parse inner HTTP/1.1 requests off the TLS-decrypted stream. We use an
  // inline http.Server with `request` events instead of an external library.
  const inner = http.createServer(async (req, res) => {
    // Reconstruct full URL — req.url here is just the path.
    const target = { hostname: reqHost, port: reqPort, path: req.url, protocol: 'https:' };
    return handleInterceptedHttpRequest(req, res, target, reporter, log, upstreamTlsOptions, { onApiCall, peerPort });
  });
  inner.emit('connection', tlsServer);
  // ^ giving the http.Server our already-established TLS socket directly is
  // how we get it to parse requests off the stream without re-listening.
}

async function handleInterceptedHttpRequest(req, res, target, reporter, log, upstreamTlsOptions, hooks = {}) {
  const startedAt = Date.now();
  const body = await readRequestBody(req, BODY_SCAN_MAX_BYTES);

  // Skip-list: telemetry / sentinel / health / static paths get forwarded
  // without scanning. Their bodies are noise (IDs, timestamps, JWTs in
  // auth) and false-positive aggressively. See scan-policy.js.
  let blockMatches = null;
  const skipped = shouldSkipScan(target.hostname, target.path);
  const bodyLen = body.raw ? body.raw.length : 0;
  const textLen = body.text ? body.text.length : 0;
  log?.info?.(`proxy: req ${req.method} ${target.hostname}${target.path} body=${bodyLen}B text=${textLen}B skip=${skipped}`);
  if (!skipped) {
    const text = body.text;
    if (text) {
      const result = scan(text);
      // Only prefix-anchored secret patterns trigger a proxy-level block.
      // The looser patterns (credit-card, us-ssn, jwt, ...) still fire at
      // the user-input layers (hook, extension, clipboard). See PROXY_BLOCK_PATTERNS.
      const blockers = blockableMatches(result.matches || []);
      if (blockers.length > 0) blockMatches = blockers;
    }
  }

  if (blockMatches) {
    log?.info?.(`proxy: BLOCK ${target.hostname}${target.path} — ${blockMatches.map((m) => m.pattern).join(', ')}`);
    reporter?.enqueue?.({
      kind: 'enforcement_block',
      blocked_for: 'prompt_submit',
      service: target.hostname,
      mechanism: 'proxy_block',
      content_length: body.text ? body.text.length : (body.raw ? body.raw.length : 0),
      matches: blockMatches.map((m) => ({ pattern: m.pattern, class: m.class, severity: m.severity, count: m.count })),
      highest_severity: highestSeverity(blockMatches),
    });
    const blockBody = BLOCK_BODY(blockMatches);
    res.writeHead(451, {
      'content-type':   'application/json',
      'content-length': Buffer.byteLength(blockBody),
      'connection':     'close',
      'x-cloudfuze-block': 'true',
    });
    return res.end(blockBody);
  }

  // Forward to origin.
  forwardHttpsToOrigin(req, res, target, body.raw, log, upstreamTlsOptions, { ...hooks, startedAt });
}

function forwardHttpsToOrigin(req, res, target, rawBody, log, upstreamTlsOptions, hooks = {}) {
  // RFC 7230 hop-by-hop strip + reset Content-Length to the buffered size.
  // Without this, Cloudflare (in front of OpenAI, Anthropic, etc.) sees a
  // request whose Transfer-Encoding/Content-Length headers don't match the
  // actual bytes we send, and returns 431 / "Request Header Fields Too Large"
  // or other body-framing errors.
  const headers = stripHopByHop(req.headers);
  delete headers['proxy-connection'];
  delete headers['proxy-authorization'];
  if (rawBody && rawBody.length > 0) {
    headers['content-length'] = String(rawBody.length);
  } else if (req.method && req.method !== 'GET' && req.method !== 'HEAD') {
    headers['content-length'] = '0';
  }

  const outReq = https.request({
    hostname: target.hostname,
    port: target.port || 443,
    path: target.path || '/',
    method: req.method,
    headers,
    ...(upstreamTlsOptions || {}),
  }, (originRes) => {
    // Stream response back unmodified — preserves SSE for streaming AI responses.
    res.writeHead(originRes.statusCode || 502, originRes.headers);

    // If a server-monitor hook is attached, tee the response body (capped) so
    // we can extract token usage / cost when the response finishes. Hook is
    // fire-and-forget; exceptions never affect the forwarded stream.
    if (typeof hooks?.onApiCall === 'function') {
      const RESP_CAP = 2 * 1024 * 1024;
      const chunks = [];
      let totalLen = 0;
      let truncated = false;
      originRes.on('data', (chunk) => {
        if (totalLen < RESP_CAP) {
          const remaining = RESP_CAP - totalLen;
          chunks.push(chunk.length > remaining ? chunk.subarray(0, remaining) : chunk);
        } else {
          truncated = true;
        }
        totalLen += chunk.length;
      });
      originRes.on('end', () => {
        try {
          hooks.onApiCall({
            host: target.hostname,
            path: target.path || '/',
            method: req.method,
            requestHeaders: req.headers,
            requestBody: rawBody || Buffer.alloc(0),
            responseStatus: originRes.statusCode || 0,
            responseHeaders: originRes.headers,
            responseBody: Buffer.concat(chunks),
            responseTruncated: truncated,
            startedAt: hooks.startedAt || Date.now(),
            durationMs: Date.now() - (hooks.startedAt || Date.now()),
            peerPort: hooks.peerPort || null,
          });
        } catch (e) {
          log?.warn?.(`proxy: onApiCall hook error: ${e?.message || e}`);
        }
      });
    }

    originRes.pipe(res);
  });
  outReq.on('error', (err) => {
    log?.warn?.(`proxy: upstream error ${target.hostname}: ${err?.code || err?.message}`);
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' });
    res.end('upstream error');
  });
  if (rawBody && rawBody.length > 0) outReq.write(rawBody);
  outReq.end();
}

function forwardPlainHttp(req, res, target) {
  const headers = stripHopByHop(req.headers);
  delete headers['proxy-connection'];
  delete headers['proxy-authorization'];
  const outReq = http.request({
    hostname: target.hostname,
    port: target.port || 80,
    path: target.path || '/',
    method: req.method,
    headers,
  }, (originRes) => {
    res.writeHead(originRes.statusCode || 502, originRes.headers);
    originRes.pipe(res);
  });
  outReq.on('error', () => { try { res.writeHead(502); res.end('upstream error'); } catch {} });
  req.pipe(outReq);
}

// ---- Raw socket bridge for non-intercepted CONNECTs ----

function bridgeRawTls(clientSocket, head, reqHost, reqPort, log) {
  const upstream = net.connect(reqPort, reqHost, () => {
    clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    if (head && head.length) upstream.write(head);
    upstream.pipe(clientSocket);
    clientSocket.pipe(upstream);
  });
  const onErr = (where) => (err) => {
    log?.warn?.(`proxy: bridge ${where} error ${reqHost}: ${err?.code || err?.message}`);
    try { clientSocket.destroy(); } catch {}
    try { upstream.destroy(); } catch {}
  };
  upstream.on('error', onErr('upstream'));
  clientSocket.on('error', onErr('client'));
}

// ---- helpers ----

function parseProxiedUrl(reqUrl, hostHeader) {
  // Direct proxy clients send absolute URLs ("GET http://x/y HTTP/1.1"); a
  // few send just the path and rely on Host:. Handle both.
  try {
    if (/^https?:\/\//i.test(reqUrl)) {
      const u = new URL(reqUrl);
      return { hostname: u.hostname, port: u.port ? Number(u.port) : (u.protocol === 'https:' ? 443 : 80), path: u.pathname + u.search, protocol: u.protocol };
    }
    if (hostHeader) {
      const [hn, p] = hostHeader.split(':');
      return { hostname: hn, port: p ? Number(p) : 80, path: reqUrl, protocol: 'http:' };
    }
  } catch {}
  return null;
}

function readRequestBody(req, maxBytes) {
  return new Promise((resolve) => {
    const chunks = [];
    let bytes = 0;
    let truncated = false;
    req.on('data', (c) => {
      bytes += c.length;
      if (bytes > maxBytes) {
        truncated = true;
        return;     // stop accumulating but still drain
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks, Math.min(bytes, maxBytes));
      let text = null;
      try {
        text = raw.toString('utf8');
        // Heuristic: if it's mostly binary, don't pattern-scan as text.
        if (/[\x00-\x08\x0e-\x1f]/.test(text.slice(0, 256))) text = null;
      } catch {
        text = null;
      }
      resolve({ raw, text, truncated });
    });
    req.on('error', () => resolve({ raw: Buffer.alloc(0), text: null, truncated: false }));
  });
}

function highestSeverity(matches) {
  const order = ['low', 'moderate', 'high', 'critical'];
  let top = null;
  for (const m of matches) if (order.indexOf(m.severity) > order.indexOf(top)) top = m.severity;
  return top;
}
