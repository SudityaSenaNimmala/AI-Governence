// Identity Beacon — tiny localhost HTTP server that the browser extension
// queries to discover the machine's hostname + attributed user + machineId.
//
// Listens on 127.0.0.1:19532 (localhost only — not exposed to the network).
// Returns JSON: { hostname, user, osUser, identitySource, machineId, platform }
//
// The browser extension fetches http://localhost:19532/cfai/identity on startup.
// If it responds → auto-link. If it doesn't → agent not running, extension is standalone.

import http from 'node:http';
import os from 'node:os';

// Try these ports in order. If one is occupied, try the next.
// The extension checks all of them to find the beacon.
export const BEACON_PORTS = [19532, 19533, 19534, 19535, 19536];
const HOST = '127.0.0.1';

// `user` is the identity the CALLER already enrolled with — normally the corporate
// UPN from util/corporate-identity.js. It is passed in rather than derived here so
// the beacon cannot disagree with what the server was told: the extension trusts
// this value, and an extension attributing usage to a different string than the
// agent on the same machine is the exact duplicate-row bug this plumbing exists
// to prevent. Falls back to the OS username so an older caller still works.
export function startIdentityBeacon({ machineId, user, identitySource, log }) {
  const hostname = os.hostname();
  const osUser = os.userInfo().username;
  const identity = user || osUser;
  const platform = process.platform;

  // osUser is reported ALONGSIDE the attributed identity, never instead of it.
  // When `user` is a UPN the OS account is still what an admin greps for in an
  // event log or a support call, and dropping it would make a beacon response
  // impossible to tie back to a Windows session.
  const payload = JSON.stringify({
    hostname,
    user: identity,
    osUser,
    identitySource: identitySource || (user ? 'caller' : 'os_user'),
    machineId,
    platform,
    ports: BEACON_PORTS,
  });

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

  // Try ports in order until one works.
  let portIndex = 0;

  // ONE 'listening' handler for the whole retry sequence, reading the port back
  // from the socket rather than from a closure.
  //
  // Passing the callback to server.listen() registers a fresh one-time listener
  // per attempt, and an attempt that fails with EADDRINUSE never fires — so its
  // listener stayed registered and fired later alongside the one that succeeded.
  // The beacon then logged itself as serving on TWO ports, one of which it was
  // not. That line is the first step of the rollout's own verification ("browse to
  // 127.0.0.1:19532"), so a wrong port here sends whoever is checking to a dead
  // address and makes a working install look broken.
  server.on('listening', () => {
    const port = server.address()?.port;
    log?.info?.(`identity-beacon: serving ${hostname}/${identity} on http://${HOST}:${port}/cfai/identity`);
  });

  function tryListen() {
    if (portIndex >= BEACON_PORTS.length) {
      log?.warn?.('identity-beacon: all ports occupied (' + BEACON_PORTS.join(', ') + ')');
      return;
    }
    const port = BEACON_PORTS[portIndex];
    server.once('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        // A BUSY 19532 IS USUALLY A STALE BEACON, NOT A CONFLICT. The extension's
        // fetchBeacon() probes these ports in order and takes the FIRST that
        // answers, so an older tracker still holding 19532 keeps answering with
        // the identity IT resolved — and a freshly deployed agent on 19533 is
        // never consulted. The fleet installer calls stopRunningInstances() before
        // registering the new task for exactly this reason; this log line is how
        // you find the machine where that did not happen.
        log?.info?.(`identity-beacon: port ${port} in use, trying next...`);
        portIndex++;
        tryListen();
      } else {
        log?.warn?.(`identity-beacon: ${err.message}`);
      }
    });
    server.listen(port, HOST);
  }

  tryListen();
  return server;
}
