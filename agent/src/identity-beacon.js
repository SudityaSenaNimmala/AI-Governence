// Identity Beacon — tiny localhost HTTP server that the browser extension
// queries to discover the machine's hostname + OS user + machineId.
//
// Listens on 127.0.0.1:19532 (localhost only — not exposed to the network).
// Returns JSON: { hostname, user, machineId, platform }
//
// The browser extension fetches http://localhost:19532/cfai/identity on startup.
// If it responds → auto-link. If it doesn't → agent not running, extension is standalone.

import http from 'node:http';
import os from 'node:os';

// Try these ports in order. If one is occupied, try the next.
// The extension checks all of them to find the beacon.
export const BEACON_PORTS = [19532, 19533, 19534, 19535, 19536];
const HOST = '127.0.0.1';

export function startIdentityBeacon({ machineId, log }) {
  const hostname = os.hostname();
  const user = os.userInfo().username;
  const platform = process.platform;

  const payload = JSON.stringify({ hostname, user, machineId, platform, ports: BEACON_PORTS });

  const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

    if (req.url === '/cfai/identity' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(payload);
    }

    res.writeHead(404);
    res.end();
  });

  // Try ports in order until one works
  let portIndex = 0;

  function tryListen() {
    if (portIndex >= BEACON_PORTS.length) {
      log?.warn?.('identity-beacon: all ports occupied (' + BEACON_PORTS.join(', ') + ')');
      return;
    }
    const port = BEACON_PORTS[portIndex];
    server.once('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        log?.info?.(`identity-beacon: port ${port} in use, trying next...`);
        portIndex++;
        tryListen();
      } else {
        log?.warn?.(`identity-beacon: ${err.message}`);
      }
    });
    server.listen(port, HOST, () => {
      log?.info?.(`identity-beacon: serving ${hostname}/${user} on http://${HOST}:${port}/cfai/identity`);
    });
  }

  tryListen();
  return server;
}
