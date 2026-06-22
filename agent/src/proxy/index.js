// CloudFuze AI Governance — proxy orchestrator.
//
// Wires together CA, trust-store install, the MITM proxy server, and the
// Reporter that ships events to the governance backend.
//
// CLI entrypoint: `node src/index.js --proxy [--proxy-port 8443]`
// Uninstall:     `node src/index.js --proxy --uninstall`

import { loadOrCreateCA } from './ca.js';
import { installCA, uninstallCA } from './trust-win32.js';
import { startProxy } from './proxy-server.js';
import { activateSystemProxy, deactivateSystemProxy, STATE_PATH as PROXY_STATE_PATH } from './system-proxy-win32.js';
import { start as startResolver, stop as stopResolver } from './process-resolver-win32.js';
import { startPacServer } from './pac-server.js';
import { spawnWatchdog } from './watchdog.js';
import { Reporter } from '../os_monitor/reporter.js';
import { DiscoveryReporter } from './discovery-reporter.js';
import { parseApiCall } from '../server-monitor/cost-parser.js';

export async function runProxy({
  serverUrl,
  token,
  port = 8443,
  pacPort = 8445,
  mode = 'pac',         // 'pac' (graceful fallback) or 'static' (no fallback)
  activateSystem = true,
  watchdog = true,
  log,
}) {
  if (process.platform !== 'win32') {
    log?.warn?.(`proxy: only Windows is supported in v1 (saw ${process.platform})`);
  }

  // 1. CA — load or create.
  const ca = await loadOrCreateCA({ log });

  // 2. Trust store — install (idempotent).
  const trust = await installCA({
    caCertPem: ca.caCertPem,
    fingerprintSha256: ca.fingerprintSha256,
    log,
  });
  if (trust.installed) log?.info?.('proxy: CA installed into user trust store');
  else if (trust.already) log?.info?.('proxy: CA already trusted (no change)');

  // 3. Reporter — shares the OS monitor's event pipeline so dashboard groups
  //    proxy_block events with the other governance events.
  let reporter = null;
  if (serverUrl && token) {
    reporter = new Reporter({ serverUrl, token, log: log?.child?.('reporter') ?? log });
    reporter.start();
  } else {
    log?.warn?.('proxy: no server+token configured — events will not be reported');
  }

  // 4. Background process resolver for browser/desktop-app detection at
  //    CONNECT time. Start BEFORE the listener so the first connections
  //    have a populated cache.
  startResolver({ log });

  // 4b. Discovery reporter — batches unknown-AI-host detections from the
  //    cost-parser and POSTs them to /api/v1/discovered-apps so they show
  //    up in the dashboard's Discovery tray.
  let discoveryReporter = null;
  if (serverUrl && token) {
    discoveryReporter = new DiscoveryReporter({ serverUrl, token, log: log?.child?.('discovery') ?? log });
    discoveryReporter.start();
  }

  // onApiCall hook — called by the MITM with the captured request+response.
  // Runs parseApiCall to detect known providers AND unknown AI-shaped traffic.
  // For known providers, the existing DLP/Reporter pipeline already handles it;
  // we only act here on the _discovered breadcrumb (the "every AI app" path).
  const onApiCall = (call) => {
    try {
      const parsed = parseApiCall({
        host: call.host,
        path: call.path,
        requestBody:    call.requestBody,
        requestHeaders: call.requestHeaders,
        responseBody:   call.responseBody,
        responseHeaders: call.responseHeaders,
      });
      if (parsed?._discovered && discoveryReporter) {
        discoveryReporter.record({
          host:         parsed._discovered.host,
          wire_format:  parsed._discovered.wireFormat,
          sample_path:  parsed._discovered.urlPath,
          sample_model: parsed.model,
        });
      }
    } catch (e) {
      log?.warn?.(`proxy: discovery hook error: ${e?.message || e}`);
    }
  };

  // 5. MITM proxy server. Must be listening BEFORE we touch the system proxy
  //    (system-proxy-win32 does its own listen-probe but we want the visible
  //    log line first).
  const { server, stop } = await startProxy({ ca, reporter, log, port, onApiCall });

  // 6. PAC server (only needed for PAC mode). Tiny static HTTP server on a
  //    separate port — its purpose is to keep serving the PAC file with a
  //    DIRECT fallback even if the MITM crashes, so browsers degrade
  //    gracefully instead of bricking the user's machine.
  let pac = null;
  if (mode === 'pac') {
    pac = await startPacServer({ pacPort, proxyHost: '127.0.0.1', proxyPort: port, log });
  }

  // 7. System proxy registration. Off by default in caller-passed activateSystem=false
  //    so callers (tests, future --proxy --no-activate flag) can skip it.
  let sysProxyState = null;
  if (activateSystem) {
    sysProxyState = await activateSystemProxy({
      mode,
      host: '127.0.0.1',
      port,
      pacUrl: pac?.url,
      log,
    });
  } else {
    log?.info?.('proxy: system proxy activation skipped (activateSystem=false)');
  }

  // 8. Watchdog sidecar — detached child that restores the registry if THIS
  //    process dies hard (taskkill /F, BSOD). In-process exit hooks handle
  //    graceful shutdown; the watchdog covers everything they can't.
  let watchdogChild = null;
  if (activateSystem && watchdog) {
    watchdogChild = spawnWatchdog({ parentPid: process.pid, statePath: PROXY_STATE_PATH, log });
  }

  // Graceful shutdown — restore system proxy FIRST, then close listeners.
  // (The system-proxy module also installs its own exit hooks as a backstop
  // for hard kills, but in the normal SIGINT path we want a single coherent
  // shutdown order.)
  const shutdown = async () => {
    log?.info?.('proxy: shutting down');
    try { await deactivateSystemProxy({ log }); } catch (e) { log?.warn?.(`proxy: deactivate failed: ${e?.message || e}`); }
    try { await pac?.stop(); } catch {}
    try { await stop(); } catch {}
    try { stopResolver(); } catch {}
    try { reporter?.stop(); } catch {}
    try { discoveryReporter?.stop(); } catch {}
    // The detached watchdog will notice the parent is gone within POLL_MS
    // and exit on its own (it'll find STATE_PATH already removed → no-op).
    process.exit(0);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  return { ca, server, reporter, sysProxyState, pac, watchdogChild };
}

/** `--proxy --uninstall` — restore system proxy + remove CA from trust store. */
export async function runProxyUninstall({ log }) {
  const sys = await deactivateSystemProxy({ log });
  if (sys?.restored) log?.info?.('proxy: system proxy restored to pre-CloudFuze state');

  const ca = await uninstallCA({ log });
  log?.info?.(`proxy: uninstall — removed ${ca.removed} CA cert(s) from trust store`);

  // (We intentionally keep ~/.cloudfuze-aigov/ca/ on disk so a future --proxy
  // run reuses the same CA — re-installing the same cert is a no-op.)
}
