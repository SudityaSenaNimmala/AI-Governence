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

const PORT = 19532;
const HOST = '127.0.0.1';  // localhost only — never exposed externally

export function startIdentityBeacon({ machineId, log }) {
  const hostname = os.hostname();
  const user = os.userInfo().username;
  const platform = process.platform;

  const payload = JSON.stringify({ hostname, user, machineId, platform });

  const server = http.createServer((req, res) => {
    // CORS headers so browser extension can fetch from localhost
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      return res.end();
    }

    if (req.url === '/cfai/identity' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(payload);
    }

    res.writeHead(404);
    res.end();
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      log?.warn?.(`identity-beacon: port ${PORT} already in use (another agent instance?)`);
    } else {
      log?.warn?.(`identity-beacon: ${err.message}`);
    }
  });

  server.listen(PORT, HOST, () => {
    log?.info?.(`identity-beacon: serving ${hostname}/${user} on http://${HOST}:${PORT}/cfai/identity`);
  });

  return server;
}
