// PAC (Proxy Auto-Config) server.
//
// Serves a tiny static JavaScript file at http://127.0.0.1:<pacPort>/proxy.pac
// that browsers (via Windows AutoConfigURL) consult on every request to decide
// which proxy to use.
//
// Why PAC instead of pointing ProxyServer directly at the MITM:
//
//   When ProxyEnable=1 + ProxyServer=127.0.0.1:8443 and the MITM is down,
//   every browser fails with ERR_PROXY_CONNECTION_FAILED — the user's machine
//   is bricked for HTTPS until they unset the registry by hand. With PAC, the
//   returned proxy list is "PROXY 127.0.0.1:8443; DIRECT" — the trailing
//   DIRECT means: "if the named proxy is unreachable, just go direct."
//   Browsers honor this within seconds. The failure mode goes from
//   "all browsing dead" to "AI traffic temporarily unproxied (and unblocked,
//   logged later by other layers)" — recoverable, not catastrophic.
//
// Why a separate port from the MITM (8445 vs 8443):
//
//   If the PAC file lived on 8443, the MITM going down would also kill PAC,
//   so on the next browser fetch of the PAC file the browser would fall back
//   to its cached PAC (usually fine) — BUT if the cache had expired, it would
//   fail open in a more confusing way. Putting PAC on its own tiny http.Server
//   that does nothing but serve one static string means it is far less likely
//   to crash with the MITM.

import http from 'node:http';

/**
 * Build the PAC script body. Hosts on the bypass list always return DIRECT.
 * Everything else returns "PROXY <proxy>; DIRECT" so the browser falls back
 * to direct when the proxy is unreachable.
 */
export function buildPac({ proxyHost = '127.0.0.1', proxyPort = 8443 } = {}) {
  const proxy = `${proxyHost}:${proxyPort}`;
  // NOTE: PAC scripts run inside the browser's restricted JS sandbox — only
  // the dnsDomainIs / shExpMatch / isPlainHostName / isInNet helpers are
  // available. No ES6, no console. Keep this ES3-compatible.
  return `function FindProxyForURL(url, host) {
  // Always direct for plain hostnames (intranet shortnames with no dot).
  if (isPlainHostName(host)) return "DIRECT";

  // Loopback and link-local — direct, so local dev servers, the PAC server
  // itself, and the dashboard work without round-tripping through the MITM.
  if (host == "127.0.0.1" || host == "localhost" || host == "::1") return "DIRECT";
  if (shExpMatch(host, "169.254.*")) return "DIRECT";

  // RFC1918 — corporate intranet ranges go direct.
  if (isInNet(host, "10.0.0.0",    "255.0.0.0"))   return "DIRECT";
  if (isInNet(host, "172.16.0.0",  "255.240.0.0")) return "DIRECT";
  if (isInNet(host, "192.168.0.0", "255.255.0.0")) return "DIRECT";

  // *.local mDNS names — direct.
  if (shExpMatch(host, "*.local")) return "DIRECT";

  // Everything else: try our MITM, fall back to DIRECT if it's down.
  // The "; DIRECT" suffix is THE reason this PAC exists — it converts a
  // proxy outage from "all browsing broken" to "AI traffic unproxied".
  return "PROXY ${proxy}; DIRECT";
}
`;
}

/**
 * Start the PAC HTTP server. Returns { url, stop }.
 *
 * url is the value to plug into HKCU AutoConfigURL.
 */
export async function startPacServer({
  pacHost  = '127.0.0.1',
  pacPort  = 8445,
  proxyHost = '127.0.0.1',
  proxyPort = 8443,
  log,
} = {}) {
  const body = buildPac({ proxyHost, proxyPort });

  const server = http.createServer((req, res) => {
    // Browsers fetch /proxy.pac, /wpad.dat, or sometimes /. Serve the same
    // PAC for any path — this server has exactly one job.
    res.writeHead(200, {
      // The IANA-blessed PAC MIME type. Some old clients want
      // application/x-javascript; modern browsers accept either.
      'content-type': 'application/x-ns-proxy-autoconfig',
      'cache-control': 'no-cache, no-store, must-revalidate',
      'content-length': Buffer.byteLength(body),
    });
    res.end(body);
  });

  // Reject anything that isn't local — this server should NEVER answer the
  // network. Belt and suspenders on top of binding to 127.0.0.1.
  server.on('connection', (sock) => {
    if (sock.remoteAddress && !sock.remoteAddress.startsWith('127.') && sock.remoteAddress !== '::1') {
      sock.destroy();
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(pacPort, pacHost, () => {
      server.removeListener('error', reject);
      resolve();
    });
  });

  const url = `http://${pacHost}:${pacPort}/proxy.pac`;
  log?.info?.(`proxy/pac: serving ${url} -> PROXY ${proxyHost}:${proxyPort}; DIRECT`);

  const stop = () =>
    new Promise((resolve) => {
      server.close(() => resolve());
      // close() waits for keep-alive sockets — close them now.
      server.closeAllConnections?.();
    });

  return { url, stop, server };
}
