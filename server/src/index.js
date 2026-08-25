// MUST be the first import: loads .env as a module side effect so that env vars
// are set before auth.js (or anything else) is evaluated. See src/env.js.
import './env.js';

import express from 'express';
import cors from 'cors';
import { openDb, applyInitialSchema, ensureAnalyticsIndexes } from './db.js';
import { mountReports } from './routes/reports.js';
import { mountQueries } from './routes/queries.js';
import { mountSanctions } from './routes/sanctions.js';
import { mountEnroll } from './routes/enroll.js';
import { mountDlp } from './routes/dlp.js';
import { mountSessions } from './routes/sessions.js';
import { mountConversations } from './routes/conversations.js';
import { mountReplays } from './routes/replays.js';
import { startReplayRetentionSweeper } from './lib/replay-retention.js';
import { mountServerAgents } from './routes/server-agents.js';
import { mountDiscovered } from './routes/discovered.js';
import { mountClassifications } from './routes/classifications.js';
import { mountAiPlatforms } from './routes/ai-platforms.js';
import { mountAiSurfaces } from './routes/ai-surfaces.js';
import { mountRouting } from './routes/routing.js';
import { mountIdentity, resolveProfiles } from './routes/identity.js';
import { mountRiskScore } from './routes/risk-score.js';
import { mountRegistry } from './routes/registry.js';
import { mountAccessRequests } from './routes/access-requests.js';
import { mountExtensionHosting } from './routes/extension-hosting.js';
import { mountWebhooks } from './routes/webhooks.js';
import { mountConnections } from './routes/connections.js';
import { mountInstallations } from './routes/installations.js';
import { mountSdk } from './routes/sdk.js';
import { mountSdkDownload } from './routes/sdk-download.js';
import { mountLangfuseGateway } from './routes/langfuse-gateway.js';
import { mountTracing } from './routes/tracing.js';
import { mountTracingIngestBodyLimit, tracingBackend } from './lib/tracing-store.js';
import { startTracingRetentionSweeper } from './lib/tracing-retention.js';
import { mountAiUsage } from './routes/ai-usage.js';
import { mountClaudeUsage } from './routes/claude-usage.js';
import { mountOtel } from './routes/otel.js';
import { mountSignals } from './routes/signals.js';
import { mountApprovals } from './routes/approvals.js';
import { mountSiem } from './routes/siem.js';
import { seedAiPlatforms } from './seed-platforms.js';
import { seedDefaultRoutingRules } from './seed-routing.js';
import { JWT_SECRET, ENROLL_SECRET, ADMIN_TOKEN } from './auth.js';
import governanceRouter from './governance/app.js';

const PORT = Number(process.env.PORT) || 8787;
const db = await openDb();
// Writes (schema/seed) may fail if the DB is over quota — catch and continue
// so the server still starts and serves read-only + feature flags.
try { await applyInitialSchema(db); } catch (e) { console.warn('[db] schema init failed (DB may be full):', e.message); }
try { await seedAiPlatforms(db); } catch (e) { console.warn('[db] platform seed failed:', e.message); }
try { await seedDefaultRoutingRules(db); } catch (e) { console.warn('[db] routing seed failed:', e.message); }

const app = express();
app.use(cors());
// SDK tracing ingestion gets its own 5mb body cap, registered BEFORE the global
// parser below. Order is load-bearing: body-parser no-ops once a body has already
// been parsed, so a per-route limit mounted after the 50mb one would never fire.
// The global limit itself is untouched — it is sized for DLP file uploads.
mountTracingIngestBodyLimit(app);
// Bumped to 50mb to fit a single 25MB-cap event with base64 overhead (~1.33x).
// Per-event content is capped server-side in routes/dlp.js (MAX_CONTENT_BYTES).
app.use(express.json({ limit: '50mb' }));

app.get('/api/v1/health', (req, res) => {
  res.json({ ok: true, service: 'ai-governance-server', version: '0.1.0', dbKind: 'mongodb' });
});

// ── Feature flags (server-driven) ────────────────────────────────────────────
// All features default to true. Set FEAT_<NAME>=false in server/.env to disable.
// Dashboard, browser extension, and desktop agent all read this endpoint.
(() => {
  // One toggle per feature — controls dashboard tab + extension + agent together.
  const FEATURES = {
    overview:           { label: 'Overview' },
    ai_systems:         { label: 'AI Systems — registry + platform blocking (extension)' },
    agents_mcp:         { label: 'Agents & MCP — dashboard + MCP/agent discovery (agent)' },
    dlp:                { label: 'DLP — dashboard + scanning + guardrails (extension)' },
    claude_usage:       { label: 'Claude Usage' },
    policies:           { label: 'Policies' },
    risk_scores:        { label: 'Risk Scores' },
    access_requests:    { label: 'Access Requests — dashboard + access gate (extension)' },
    agent_governance:   { label: 'Agent Governance' },
    installations:      { label: 'Installations' },
    integrations:       { label: 'Integrations' },
    server_monitor:     { label: 'Server Monitor' },
    sdk:                { label: 'Developer SDK' },
    session_replay:     { label: 'Session Replay — dashboard + recording (extension)' },
    model_routing:      { label: 'Model Routing — dashboard + enforcement (extension)' },
    endpoint_scan:      { label: 'Endpoint Scan — AI tool discovery (agent)' },
    clipboard_monitor:  { label: 'Clipboard Monitor — prompt monitoring (agent)' },
  };

  app.get('/api/v1/features', (req, res) => {
    const result = {};
    for (const [key, def] of Object.entries(FEATURES)) {
      const envKey = 'FEAT_' + key.toUpperCase();
      const envVal = process.env[envKey];
      const enabled = envVal !== 'false' && envVal !== '0';
      result[key] = { label: def.label, status: enabled ? 'enabled' : 'disabled' };
    }
    res.json({ features: result });
  });
})();

mountEnroll(app, db);
mountReports(app, db);
mountQueries(app, db);
mountSanctions(app, db);
mountDlp(app, db);
mountSessions(app, db);
// The same stored turns grouped by the AI site's OWN chat thread rather than by
// engagement — admin-authenticated, matching the replay routes it links to.
mountConversations(app, db);
// Session Replay — rrweb DOM/interaction recording. Chunks are inline documents,
// so there is no blob store to build or share.
mountReplays(app, db);
mountServerAgents(app, db);
mountDiscovered(app, db);
mountClassifications(app, db);
mountAiPlatforms(app, db);
mountAiSurfaces(app);
mountRouting(app, db);
mountIdentity(app, db);
mountRiskScore(app, db);
mountRegistry(app, db);
mountAccessRequests(app, db);
mountExtensionHosting(app);
mountWebhooks(app, db);
mountConnections(app, db);
mountInstallations(app, db);
mountSdk(app, db);
// GET /api/v1/sdk/download — the JS SDK zipped from sdk-js/. Deliberately
// unauthenticated (it is our own dependency-free client library, no secrets in
// it) and therefore kept out of sdk.js, whose every route is admin-gated.
mountSdkDownload(app);
// Developer SDK ingestion gateway. Developers' Langfuse SDKs point at
// <server>/api/v1/lf with the credentials mountSdk issued; this relays to the
// real Langfuse Cloud project after stamping the per-project tenancy tag.
mountLangfuseGateway(app, db);
// Read API for traces stored locally (CFAI_TRACING_BACKEND=local, the default).
// Namespaced /api/v1/tracing/* — /api/v1/traces/* is server-agents.js's unrelated
// passive-interception pseudo-traces and must not be shadowed.
mountTracing(app, db);

// Auto-resolve employee profiles from enrolled machines on startup
resolveProfiles(db, await db.collection('machines').find({}).project({ _id: 0 }).toArray())
  .then(s => console.log(`[identity] resolved ${s.total_profiles} employee profiles (${s.created} new, ${s.updated} updated)`))
  .catch(e => console.warn('[identity] auto-resolve failed:', e.message));
mountAiUsage(app, db);
mountClaudeUsage(app, db);
mountOtel(app, db);
mountSignals(app, db);
mountApprovals(app, db);
mountSiem(app, db);

// ── Agent Governance routes (multi-platform discovery, policies, alerts, cost, etc.) ──
app.use(governanceRouter);

app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: err.message });
});

// Replay retention. A Mongo TTL index would delete the run document (the audit
// tombstone) and leave its chunk documents orphaned, so retention has to be an
// explicit sweep. Started after the routes are mounted; it runs once now and then
// on an interval.
startReplayRetentionSweeper(db);

// Tracing retention. Same argument as above and the same shape: a TTL index would
// delete the lf_traces parent and orphan its lf_observations children (and their
// raw-content rows), so the sweep is explicit — children first, parent last.
// Only meaningful for the local backend; relayed traces are Langfuse's to expire.
if (tracingBackend() === 'local') startTracingRetentionSweeper(db);

// Analytics indexes build in the background, once the port is open. Awaiting them
// before listen() would put an index build in front of the deploy health check.
ensureAnalyticsIndexes(db).catch((err) => {
  console.warn(`[db] analytics indexes not created: ${err.message} (reads still work, just slower)`);
});

// Claude Usage Tracker installer, built here rather than by hand on somebody's
// Windows laptop and copied over. Background and after listen for the same reason
// as the indexes above: it takes minutes, and nothing else should wait for it.
//
// Only when PUBLIC_SERVER_URL is set. The alternative is deriving an address from
// a request, and an installer that reports to the wrong host is worse than a
// download that says it has not been built — the first fails silently on an
// employee's machine, the second says exactly what to do.
if (process.env.PUBLIC_SERVER_URL) {
  const { ensureClaudeTracker } = await import('./lib/tracker-build.js');
  ensureClaudeTracker({
    serverUrl: process.env.PUBLIC_SERVER_URL,
    enrollSecret: ENROLL_SECRET,
    log: console,
  }).catch((err) => console.warn(`[tracker] installer preparation failed: ${err.message}`));
} else {
  console.log('[tracker] PUBLIC_SERVER_URL not set — skipping installer build (set it so downloads point at the right host)');
}

app.listen(PORT, () => {
  console.log(`AI Governance server listening on http://localhost:${PORT}`);
  console.log(`DB: MongoDB (${process.env.MONGODB_URI})`);
  console.log(`Tracing backend: ${tracingBackend()} (CFAI_TRACING_BACKEND)`);
  if (!process.env.JWT_SECRET) {
    console.log(`\n[dev] JWT_SECRET (random per-process): ${JWT_SECRET}`);
    console.log(`[dev] ENROLL_SECRET: ${ENROLL_SECRET}`);
    console.log(`[dev] ADMIN_TOKEN: ${ADMIN_TOKEN}\n`);
  }
});
