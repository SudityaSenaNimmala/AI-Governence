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
import { start as startResolver, stop as stopResolver, getProcessByLocalPort } from './process-resolver-win32.js';
import { startPacServer } from './pac-server.js';
import { spawnWatchdog } from './watchdog.js';
import { Reporter } from '../os_monitor/reporter.js';
import { DiscoveryReporter } from './discovery-reporter.js';
import { parseApiCall } from '../server-monitor/cost-parser.js';
import { ModelRouter } from './router.js';
import { createReporter } from '../server-monitor/reporter.js';

// Shape one /api/v1/server-agent-events event from an intercepted call plus
// the parseApiCall() result. Kept pure (no I/O, no globals) so the mapping is
// unit-testable — see agent/tests/proxy-api-report.test.mjs.
//
// The field names mirror what src/server-monitor/index.js sends, because both
// paths POST to the same route and land in the same `server_agent_calls`
// collection. Only `attribution` differs: the server daemon reads /proc for a
// full parent chain, while the desktop side has the Windows TCP table, which
// gives us the pid + image name of the connecting process and nothing more.
//
// KNOWN GAP (tracked separately, deliberately not solved here): there is no
// session_id on this path. session_id/client_seq only exist on the browser
// extension → /api/v1/dlp path, so desktop/API traffic captured here cannot be
// grouped into a browser conversation.
export function buildApiCallEvent({ call, parsed, proc = null }) {
  const startedAt = call.startedAt || Date.now();
  return {
    occurred_at: new Date(startedAt).toISOString(),
    duration_ms: call.durationMs ?? null,
    response_status: call.responseStatus ?? null,
    host: call.host,
    path: call.path ?? null,
    method: call.method ?? null,

    provider: parsed.provider ?? null,
    model:    parsed.model ?? null,
    prompt_tokens:     parsed.prompt_tokens ?? null,
    completion_tokens: parsed.completion_tokens ?? null,
    cached_tokens:     parsed.cached_tokens ?? null,
    cost: parsed.cost ?? null,
    prompt_text:   parsed.prompt_text ?? null,
    response_text: parsed.response_text ?? null,
    response_truncated: !!call.responseTruncated,

    attribution: proc ? {
      pid: proc.pid ?? null,
      exe: proc.name ?? null,
      cmdline: null,
      trigger_source: 'desktop_proxy',
    } : null,
  };
}

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

  // 4c. API-call reporter — ships the prompt/response/token/cost data that
  //    parseApiCall already reassembles from the intercepted traffic to
  //    /api/v1/server-agent-events. This is the SAME reporter and the same
  //    endpoint the server-monitor daemon uses (see
  //    src/server-monitor/index.js), deliberately reused rather than a second
  //    pipeline: the server route already knows this event shape and persists
  //    prompt_text / response_text verbatim.
  //
  //    Auth: the desktop proxy runs under the enrolled MACHINE token from
  //    ~/.cloudfuze-aigov/credentials.json — the same credential the DLP and
  //    discovery reporters use — and /api/v1/server-agent-events requires
  //    exactly that (requireMachineAuth). No new identity is introduced.
  let apiCallReporter = null;
  if (serverUrl && token) {
    apiCallReporter = createReporter({ serverUrl, token, log: log?.child?.('api-calls') ?? log });
  }

  // onApiCall hook — called by the MITM with the captured request+response.
  // Runs parseApiCall to detect known providers AND unknown AI-shaped traffic.
  // Two things happen with the result:
  //   1. the _discovered breadcrumb feeds the Discovery tray (the "every AI
  //      app" path), and
  //   2. the reassembled prompt_text / response_text / tokens / cost get
  //      forwarded to the governance server. Before this, all of (2) was
  //      computed and then thrown away on the desktop path.
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
      if (!parsed) return;
      if (parsed._discovered && discoveryReporter) {
        discoveryReporter.record({
          host:         parsed._discovered.host,
          wire_format:  parsed._discovered.wireFormat,
          sample_path:  parsed._discovered.urlPath,
          sample_model: parsed.model,
        });
      }
      if (apiCallReporter) {
        apiCallReporter.enqueue(buildApiCallEvent({
          call,
          parsed,
          // Best-effort only: the snapshot cache may not hold this port. We do
          // NOT do the async on-demand lookup here — the hook must stay
          // synchronous and off the request's critical path.
          proc: call.peerPort ? getProcessByLocalPort(call.peerPort) : null,
        }));
      }
    } catch (e) {
      log?.warn?.(`proxy: api-call hook error: ${e?.message || e}`);
    }
  };

  // 4c. Model Router — fetches routing rules from server, evaluates locally.
  const modelRouter = new ModelRouter({
    serverUrl: serverUrl || null,
    token: token || null,
    log: log?.child?.('router') ?? log,
  });
  if (serverUrl && token) {
    await modelRouter.start();
  }

  // 5. MITM proxy server. Must be listening BEFORE we touch the system proxy
  //    (system-proxy-win32 does its own listen-probe but we want the visible
  //    log line first).
  const { server, stop } = await startProxy({ ca, reporter, log, port, onApiCall, modelRouter });

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
    try { modelRouter?.stop(); } catch {}
    // createReporter() buffers and flushes on an interval; drain() sends what
    // is still queued before we exit.
    try { await apiCallReporter?.drain(); } catch (e) { log?.warn?.(`proxy: api-call drain failed: ${e?.message || e}`); }
    // The detached watchdog will notice the parent is gone within POLL_MS
    // and exit on its own (it'll find STATE_PATH already removed → no-op).
    process.exit(0);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  return { ca, server, reporter, apiCallReporter, sysProxyState, pac, watchdogChild };
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
