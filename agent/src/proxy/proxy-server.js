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
import { TokenVault } from './token-vault.js';
import { extractSni } from './tls-sni.js';

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

export async function startProxy({ ca, reporter, log, port = 8443, host = '127.0.0.1', upstreamTlsOptions = null, onApiCall = null, alwaysIntercept = false, tokenizePatterns = null, modelRouter = null }) {
  // ── Reversible PII Tokenization ─────────────────────────────────────
  // tokenizePatterns: Set of pattern names (e.g. new Set(['us-ssn','credit-card']))
  // whose matches should be tokenized rather than blocked. Patterns NOT in
  // this set follow the existing block path. Default: null (all block).
  const vault = new TokenVault();
  const _tokenizePatterns = tokenizePatterns || new Set();
  // Periodic GC for the vault
  const _gcInterval = setInterval(() => vault.gc(), 5 * 60 * 1000);
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
      return handleInterceptedHttpRequest(req, res, target, reporter, log, upstreamTlsOptions, { onApiCall, peerPort: req.socket?.remotePort, peerAddress: req.socket?.remoteAddress, vault, tokenizePatterns: _tokenizePatterns, modelRouter });
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
    return mitmTunnel({ clientSocket, head, reqHost, reqPort, secureContextFor, reporter, log, upstreamTlsOptions, onApiCall, peerPort: clientSocket.remotePort, peerAddress: clientSocket.remoteAddress });
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

  // ── Transparent proxy (iptables REDIRECT mode) ───────────────────────
  // When iptables redirects port-443 traffic to us, we receive raw TLS
  // ClientHello bytes instead of HTTP CONNECT. We extract the SNI hostname,
  // check the whitelist, and either MITM-intercept or bridge to the real host.
  // This captures ALL outbound HTTPS traffic — no HTTPS_PROXY env var needed.
  let transparentServer = null;
  const tpPort = port + 1;   // transparent port = proxy port + 1 (e.g. 8444)

  if (alwaysIntercept) {   // only in server-monitor mode
    // Docker bridge subnet — traffic from containers comes from 172.17.0.0/16
    // or 172.18-31.x.x (custom Docker networks). We detect this to decide
    // whether to MITM (host traffic, CA trusted) or bridge+log (container
    // traffic, CA NOT trusted — MITM would break the container's TLS).
    const isDockerIp = (ip) => {
      if (!ip) return false;
      const m = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/) || ip.match(/^(\d+\.\d+\.\d+\.\d+)$/);
      if (!m) return false;
      const parts = m[1].split('.').map(Number);
      return parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31;
    };

    transparentServer = net.createServer({ pauseOnConnect: true }, (clientSocket) => {
      clientSocket.once('readable', () => {
        const peek = clientSocket.read();
        if (!peek || peek.length === 0) { clientSocket.destroy(); return; }

        const sniHost = extractSni(peek);

        if (!sniHost) {
          log?.warn?.(`transparent: no SNI in ${peek.length} bytes, dropping`);
          clientSocket.destroy();
          return;
        }

        const fromContainer = isDockerIp(clientSocket.remoteAddress);

        if (isPinnedHost(sniHost) || !isIntercepted(sniHost)) {
          // Non-AI traffic — bridge transparently, zero overhead
          const upstream = net.createConnection(443, sniHost, () => {
            upstream.write(peek);
            clientSocket.pipe(upstream);
            upstream.pipe(clientSocket);
            clientSocket.resume();
          });
          upstream.on('error', () => { try { clientSocket.destroy(); } catch {} });
          clientSocket.on('error', () => { try { upstream.destroy(); } catch {} });
          return;
        }

        if (fromContainer) {
          // AI traffic from Docker container — bridge (don't MITM, CA not trusted
          // inside container) but LOG the metadata so it appears in dashboard.
          log?.info?.(`transparent: container AI call → ${sniHost} (bridge+log)`);
          const startedAt = Date.now();
          let bytesSent = peek.length;
          let bytesReceived = 0;
          const upstream = net.createConnection(443, sniHost, () => {
            upstream.write(peek);
            clientSocket.on('data', (chunk) => { bytesSent += chunk.length; upstream.write(chunk); });
            upstream.on('data', (chunk) => { bytesReceived += chunk.length; clientSocket.write(chunk); });
            clientSocket.resume();
          });
          const logOnEnd = () => {
            if (onApiCall) {
              onApiCall({
                host: sniHost, path: '/', method: 'POST',
                requestHeaders: {}, requestBody: null,
                responseStatus: 200, responseHeaders: {}, responseBody: null,
                responseTruncated: true,
                startedAt, durationMs: Date.now() - startedAt,
                peerPort: clientSocket.remotePort,
                peerAddress: clientSocket.remoteAddress,
                _containerMode: true,
                _bytesSent: bytesSent,
                _bytesReceived: bytesReceived,
              });
            }
          };
          upstream.on('end', logOnEnd);
          upstream.on('error', () => { try { clientSocket.destroy(); } catch {} });
          clientSocket.on('error', () => { try { upstream.destroy(); } catch {} });
          clientSocket.on('end', () => { try { upstream.end(); } catch {} });
          upstream.on('end', () => { try { clientSocket.end(); } catch {} });
          return;
        }

        // AI traffic from host process — MITM intercept (CA is trusted on host)
        log?.info?.(`transparent: intercepting ${sniHost}`);
        const tlsSock = new tls.TLSSocket(clientSocket, {
          isServer: true,
          secureContext: secureContextFor(sniHost),
        });
        tlsSock.push(peek);
        clientSocket.resume();

        tlsSock.on('error', (err) => {
          log?.warn?.(`transparent: TLS error for ${sniHost}: ${err?.code || err?.message}`);
          try { clientSocket.destroy(); } catch {}
        });

        const inner = http.createServer(async (req, res) => {
          const target = { hostname: sniHost, port: 443, path: req.url, protocol: 'https:' };
          return handleInterceptedHttpRequest(req, res, target, reporter, log, upstreamTlsOptions, { onApiCall, peerPort: clientSocket.remotePort, peerAddress: clientSocket.remoteAddress, vault, tokenizePatterns: _tokenizePatterns, modelRouter });
        });
        inner.emit('connection', tlsSock);
      });
    });

    try {
      await new Promise((resolve, reject) => {
        transparentServer.once('error', (err) => {
          log?.warn?.(`transparent: failed to start on port ${tpPort}: ${err.message}. Falling back to HTTPS_PROXY-only mode.`);
          transparentServer = null;
          resolve();   // non-fatal — explicit proxy still works
        });
        transparentServer.listen(tpPort, '0.0.0.0', () => {
          transparentServer.off('error', reject);
          log?.info?.(`transparent: listening on 0.0.0.0:${tpPort} (iptables REDIRECT target)`);
          resolve();
        });
      });
    } catch { transparentServer = null; }
  }

  return {
    server,
    transparentServer,
    transparentPort: transparentServer ? tpPort : null,
    vault,
    stop: () => new Promise((resolve) => {
      clearInterval(_gcInterval);
      if (transparentServer) transparentServer.close(() => {});
      server.close(() => resolve());
    }),
  };
}

// ---- HTTPS MITM tunnel ----

function mitmTunnel({ clientSocket, head, reqHost, reqPort, secureContextFor, reporter, log, upstreamTlsOptions, onApiCall, peerPort, peerAddress }) {
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
    return handleInterceptedHttpRequest(req, res, target, reporter, log, upstreamTlsOptions, { onApiCall, peerPort, peerAddress, vault, tokenizePatterns: _tokenizePatterns, modelRouter });
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
  let scanResult = null;   // hoisted for model-routing sensitivity
  const skipped = shouldSkipScan(target.hostname, target.path);
  const bodyLen = body.raw ? body.raw.length : 0;
  const textLen = body.text ? body.text.length : 0;
  log?.info?.(`proxy: req ${req.method} ${target.hostname}${target.path} body=${bodyLen}B text=${textLen}B skip=${skipped}`);
  let tokenizeMatches = null;
  if (!skipped) {
    const text = body.text;
    if (text) {
      const result = scan(text);
      scanResult = result;
      // Only prefix-anchored secret patterns trigger a proxy-level block.
      const blockers = blockableMatches(result.matches || []);
      if (blockers.length > 0) {
        // Separate into blockable and tokenizable based on config
        const tokenizeSet = hooks?.tokenizePatterns || new Set();
        const realBlockers = [];
        const realTokenizers = [];
        for (const m of blockers) {
          if (tokenizeSet.has(m.pattern)) realTokenizers.push(m);
          else realBlockers.push(m);
        }
        if (realBlockers.length > 0) blockMatches = realBlockers;
        if (realTokenizers.length > 0) tokenizeMatches = realTokenizers;
      }
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

  // ── Tokenization path ──────────────────────────────────────────────
  // If matched patterns are configured for tokenization (not blocking),
  // replace sensitive values with reversible tokens and forward.
  let forwardBody = body.raw;
  if (tokenizeMatches && body.text && hooks?.vault) {
    const vault = hooks.vault;
    const tokenizeSet = hooks.tokenizePatterns;
    let tokenizedText = body.text;
    let tokenCount = 0;
    // Import scan patterns — reuse the classifier's regex catalog
    const { matches: allMatches } = scan(body.text);
    // We need to do regex replacement inline. Use the scan results to know
    // which patterns matched, then re-run the regexes to replace values.
    try {
      // Dynamic import of PATTERNS is complex; use a simple approach:
      // parse the JSON body and tokenize user message fields.
      const json = JSON.parse(body.text);
      const processStr = (str) => {
        let result = str;
        for (const m of tokenizeMatches) {
          // Reconstruct the regex from classifier — match the pattern name
          const regexes = {
            'openai-api-key': /\b(sk-(?:proj-)?[A-Za-z0-9_-]{20,})\b/g,
            'anthropic-api-key': /\b(sk-ant-(?:api\d{2}-)?[A-Za-z0-9_-]{20,})\b/g,
            'google-api-key': /\b(AIza[0-9A-Za-z_-]{30,})\b/g,
            'huggingface-token': /\b(hf_[A-Za-z0-9]{30,})\b/g,
            'github-pat': /\b(gh[pousr]_[A-Za-z0-9]{30,})\b/g,
            'gitlab-pat': /\b(glpat-[A-Za-z0-9_-]{20,})\b/g,
            'aws-access-key': /\b(AKIA[0-9A-Z]{16})\b/g,
            'slack-token': /\b(xox[abprs]-[A-Za-z0-9-]{10,})\b/g,
            'cloudfuze-customer-id': /\bCF-CUST-[A-Z0-9]{6,}\b/g,
          };
          const rx = regexes[m.pattern];
          if (!rx) continue;
          rx.lastIndex = 0;
          result = result.replace(rx, (match) => {
            tokenCount++;
            return vault.create(match, m.pattern);
          });
        }
        return result;
      };
      // Walk common AI API structures
      if (Array.isArray(json.messages)) {
        for (const msg of json.messages) {
          if (typeof msg.content === 'string') msg.content = processStr(msg.content);
          if (Array.isArray(msg.content)) {
            for (const block of msg.content) {
              if (block && typeof block.text === 'string') block.text = processStr(block.text);
            }
          }
        }
      }
      if (typeof json.prompt === 'string') json.prompt = processStr(json.prompt);

      if (tokenCount > 0) {
        tokenizedText = JSON.stringify(json);
        forwardBody = Buffer.from(tokenizedText, 'utf8');
        log?.info?.(`proxy: TOKENIZED ${target.hostname}${target.path} — ${tokenCount} values (${tokenizeMatches.map(m => m.pattern).join(', ')})`);
        reporter?.enqueue?.({
          kind: 'enforcement_tokenize',
          blocked_for: 'prompt_submit',
          service: target.hostname,
          mechanism: 'proxy_tokenize',
          content_length: body.text.length,
          token_count: tokenCount,
          matches: tokenizeMatches.map((m) => ({ pattern: m.pattern, class: m.class, severity: m.severity, count: m.count })),
          highest_severity: highestSeverity(tokenizeMatches),
        });
      }
    } catch (e) {
      log?.warn?.(`proxy: tokenization parse error: ${e?.message}`);
      // Fall through — forward original body
    }
  }

  // ── Model routing ─────────────────────────────────────────────────
  // Evaluate cached routing rules BEFORE forwarding. If a rule matches,
  // rewrite the model field in the JSON body (and optionally the target
  // host). This happens AFTER DLP scan/tokenization so the sensitivity
  // classification is already available. The decision is <1ms (local).
  const router = hooks?.modelRouter;
  if (router?.ready && body.text && req.method === 'POST') {
    try {
      const json = forwardBody !== body.raw
        ? JSON.parse(forwardBody.toString('utf8'))  // already modified by tokenization
        : JSON.parse(body.text);                     // parse fresh

      if (json.model) {
        // Use the full DLP scan result for sensitivity (covers all matched
        // patterns, not just blocked/tokenized ones).
        const sensitivity = scanResult?.matches?.length
          ? highestSeverity(scanResult.matches)
          : tokenizeMatches ? highestSeverity(tokenizeMatches)
          : 'low';
        // Extract prompt text for complexity classification
        let promptText = '';
        if (Array.isArray(json.messages)) {
          for (const msg of json.messages) {
            if (msg.role === 'user') {
              if (typeof msg.content === 'string') promptText += msg.content + ' ';
              else if (Array.isArray(msg.content)) {
                for (const b of msg.content) {
                  if (b && typeof b.text === 'string') promptText += b.text + ' ';
                }
              }
            }
          }
        } else if (typeof json.prompt === 'string') {
          promptText = json.prompt;
        }

        const decision = router.decide({
          host: target.hostname,
          model: json.model,
          text: promptText,
          sensitivity,
        });

        if (decision.routed) {
          const originalModel = json.model;
          json.model = decision.model;
          if (decision.host) target.hostname = decision.host;
          forwardBody = Buffer.from(JSON.stringify(json), 'utf8');
          log?.info?.(`proxy: ROUTED ${target.hostname} model ${originalModel} → ${decision.model} (rule: ${decision.rule_name})`);

          reporter?.enqueue?.({
            kind: 'model_routed',
            service: target.hostname,
            mechanism: 'proxy_route',
            original_model: originalModel,
            routed_model: decision.model,
            routed_host: decision.host || null,
            rule_id: decision.rule_id,
            rule_name: decision.rule_name,
            sensitivity: decision.sensitivity,
            complexity: decision.complexity,
            prompt_tokens_est: decision.prompt_tokens_est,
          });
        }
      }
    } catch (e) {
      // Non-fatal — forward the original body if routing fails
      log?.warn?.(`proxy: routing error: ${e?.message}`);
    }
  }

  // Forward to origin.
  forwardHttpsToOrigin(req, res, target, forwardBody, log, upstreamTlsOptions, { ...hooks, startedAt, vault: hooks?.vault });
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
    // ── Response token restoration ─────────────────────────────────────
    // If the vault has active tokens, scan the response for them and
    // restore originals. For non-streaming responses we buffer, replace,
    // and send. For SSE/streaming, tokens are rare in responses (LLMs
    // echo placeholders verbatim) so we pass through and let the client-
    // side (browser extension MutationObserver) handle restoration.
    const responseVault = hooks?.vault;
    const contentType = (originRes.headers?.['content-type'] || '');
    const isStreaming = contentType.includes('text/event-stream') || contentType.includes('stream');

    if (responseVault && responseVault.size > 0 && !isStreaming) {
      // Buffer the non-streaming response, restore tokens, then send
      const chunks = [];
      originRes.on('data', (c) => chunks.push(c));
      originRes.on('end', () => {
        let responseBody = Buffer.concat(chunks);
        try {
          const text = responseBody.toString('utf8');
          if (responseVault.hasTokens(text)) {
            const restored = responseVault.restore(text);
            responseBody = Buffer.from(restored, 'utf8');
            log?.info?.(`proxy: restored tokens in response from ${target.hostname}`);
          }
        } catch {}
        const resHeaders = { ...originRes.headers };
        resHeaders['content-length'] = String(responseBody.length);
        res.writeHead(originRes.statusCode || 502, resHeaders);
        res.end(responseBody);
      });

      // Still tee for server-monitor hook if present
      if (typeof hooks?.onApiCall === 'function') {
        const RESP_CAP = 2 * 1024 * 1024;
        const hookChunks = [];
        let totalLen = 0;
        let truncated = false;
        originRes.on('data', (chunk) => {
          if (totalLen < RESP_CAP) hookChunks.push(chunk.length > (RESP_CAP - totalLen) ? chunk.subarray(0, RESP_CAP - totalLen) : chunk);
          else truncated = true;
          totalLen += chunk.length;
        });
        originRes.on('end', () => {
          try {
            hooks.onApiCall({
              host: target.hostname, path: target.path || '/', method: req.method,
              requestHeaders: req.headers, requestBody: rawBody || Buffer.alloc(0),
              responseStatus: originRes.statusCode || 0, responseHeaders: originRes.headers,
              responseBody: Buffer.concat(hookChunks), responseTruncated: truncated,
              startedAt: hooks.startedAt || Date.now(),
              durationMs: Date.now() - (hooks.startedAt || Date.now()),
              peerPort: hooks.peerPort || null,
            peerAddress: hooks.peerAddress || null,
            });
          } catch (e) { log?.warn?.(`proxy: onApiCall hook error: ${e?.message || e}`); }
        });
      }
      return;
    }

    // No tokenization — stream response back unmodified (preserves SSE).
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
            peerAddress: hooks.peerAddress || null,
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
