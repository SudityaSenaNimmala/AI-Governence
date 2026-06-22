#!/usr/bin/env node
// CloudFuze server-monitor daemon.
//
// Runs on a Linux server alongside the customer's AI agents. Boots an HTTPS
// MITM proxy (reuses the desktop agent's proxy engine) and reports every
// intercepted LLM API call to the governance server with:
//   - what (provider + model + prompt + response)
//   - who (real human via /proc/<pid>/loginuid, surviving sudo)
//   - which agent  (cmdline + cwd from /proc/<pid>)
//   - how triggered (parent-chain walk: cron / systemd / sshd / ci)
//   - cost (tokens × pricing table)
//
// Env vars (see install.sh for the systemd unit defaults):
//   GOV_SERVER_URL     governance server base URL (e.g. https://gov.cloudfuze.com)
//   GOV_ENROLL_SECRET  one-shot enrollment secret (rotated after first start)
//   PROXY_LISTEN_HOST  default 127.0.0.1
//   PROXY_LISTEN_PORT  default 8443
//   TOKEN_FILE         where to persist the daemon's machine token
//                      (default /etc/cloudfuze/server-monitor.token.json)

import process from 'node:process';
import { loadOrCreateCA } from '../proxy/ca.js';
import { startProxy } from '../proxy/proxy-server.js';
import { attribute } from './attribution.js';
import { pidForLocalPort, ensureStarted as ensurePortLookupStarted } from './port-lookup.js';
import { parseApiCall } from './cost-parser.js';
import { ensureEnrolled } from './enroll.js';
import { createReporter } from './reporter.js';
import { startGpuWatch } from './gpu-watch.js';
import { startAuditWatch } from './audit-watch.js';
import { startShimIngest } from './shim-ingest.js';
import { startEbpfCapture } from './ebpf-launcher.js';

const SERVER_URL    = process.env.GOV_SERVER_URL || 'http://localhost:8787';
const ENROLL_SECRET = process.env.GOV_ENROLL_SECRET || 'dev-enroll-secret-change-me';
const HOST          = process.env.PROXY_LISTEN_HOST || '127.0.0.1';
const PORT          = Number(process.env.PROXY_LISTEN_PORT) || 8443;
const TOKEN_FILE    = process.env.TOKEN_FILE || undefined;

const log = {
  info:  (m) => console.log(`[info ] ${m}`),
  warn:  (m) => console.warn(`[warn ] ${m}`),
  error: (m) => console.error(`[error] ${m}`),
};

async function main() {
  if (!['linux', 'win32', 'darwin'].includes(process.platform)) {
    log.warn(`server-monitor: unsupported platform ${process.platform}; attribution will be null.`);
  }

  log.info(`server-monitor starting (${process.platform}); governance server = ${SERVER_URL}`);
  await ensurePortLookupStarted({ log });
  const enrollment = await ensureEnrolled({ serverUrl: SERVER_URL, enrollSecret: ENROLL_SECRET, tokenFile: TOKEN_FILE, log });
  log.info(`enrolled as machineId=${enrollment.machineId} (host=${enrollment.hostname})`);

  const reporter = createReporter({ serverUrl: SERVER_URL, token: enrollment.token, log });
  // Second reporter for signal events (GPU activity, model-file loads).
  const signalReporter = createReporter({
    serverUrl: SERVER_URL, token: enrollment.token, log,
    endpoint: '/api/v1/server-agent-signals',
  });

  const ca = await loadOrCreateCA({ log });
  log.info(`CA loaded; fingerprint=${ca.fingerprintSha256}`);
  log.info('To install the CA system-wide: see install.sh (copies ca.crt to /usr/local/share/ca-certificates/ and runs update-ca-certificates).');

  // The hook fires for every intercepted API call. Attribution + cost runs
  // here, not in the proxy, to keep the proxy generic.
  const onApiCall = async (ev) => {
    const parsed = parseApiCall({
      host: ev.host,
      path: ev.path,
      requestBody: ev.requestBody,
      requestHeaders: ev.requestHeaders,
      responseBody: ev.responseBody,
      responseHeaders: ev.responseHeaders,
    });
    if (!parsed) return;     // not a known LLM endpoint, or no usage to bill

    // Attribute: peer port → PID → /proc.
    let attribution = null;
    if (ev.peerPort) {
      try {
        const pid = await pidForLocalPort(ev.peerPort);
        if (pid) attribution = await attribute(pid);
      } catch (err) {
        log.warn(`attribution failed for peerPort=${ev.peerPort}: ${err.message}`);
      }
    }

    reporter.enqueue({
      occurred_at: new Date(ev.startedAt).toISOString(),
      duration_ms: ev.durationMs,
      response_status: ev.responseStatus,
      host: ev.host,
      path: ev.path,
      method: ev.method,

      provider: parsed.provider,
      model:    parsed.model,
      prompt_tokens:     parsed.prompt_tokens,
      completion_tokens: parsed.completion_tokens,
      cached_tokens:     parsed.cached_tokens,
      cost: parsed.cost,                          // { provider, family, *_cost_usd, total_cost_usd, pricing_version }
      prompt_text:   parsed.prompt_text,
      response_text: parsed.response_text,
      response_truncated: ev.responseTruncated,

      attribution,
    });
  };

  const { stop } = await startProxy({
    ca,
    reporter: null,           // proxy's enforcement reporter — unused in server mode
    log,
    host: HOST,
    port: PORT,
    onApiCall,
    alwaysIntercept: true,    // no browsers on the server; intercept all whitelisted hosts
  });

  log.info(`proxy listening on ${HOST}:${PORT}`);
  log.info(`tell agents on this server: export HTTPS_PROXY=http://${HOST}:${PORT} (and trust the CA)`);

  // Tier 2 + Tier 3 supplementary captures — all best-effort, no-op when the
  // platform tooling isn't present.
  const gpuWatch    = startGpuWatch({ reporter: signalReporter, log });
  const auditWatch  = startAuditWatch({ reporter: signalReporter, log });
  const shimIngest  = startShimIngest({ reporter, log });
  const ebpfCapture = startEbpfCapture({ reporter, log });

  const shutdown = async (sig) => {
    log.info(`received ${sig}; draining reporter and stopping proxy`);
    try { gpuWatch?.stop?.(); } catch {}
    try { auditWatch?.stop?.(); } catch {}
    try { shimIngest?.stop?.(); } catch {}
    try { ebpfCapture?.stop?.(); } catch {}
    try { await stop(); } catch (e) { log.warn(`stop error: ${e.message}`); }
    try { await reporter.drain(); } catch (e) { log.warn(`drain error: ${e.message}`); }
    try { await signalReporter.drain(); } catch (e) { log.warn(`drain signals error: ${e.message}`); }
    process.exit(0);
  };
  process.on('SIGINT',  () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  log.error(`fatal: ${err.stack || err.message}`);
  process.exit(1);
});
