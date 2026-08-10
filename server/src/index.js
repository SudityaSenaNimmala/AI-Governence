// MUST be the first import: loads .env as a module side effect so that env vars
// are set before auth.js (or anything else) is evaluated. See src/env.js.
import './env.js';

import express from 'express';
import cors from 'cors';
import { openDb, applyInitialSchema } from './db.js';
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
import { mountRouting } from './routes/routing.js';
import { mountIdentity, resolveProfiles } from './routes/identity.js';
import { mountRiskScore } from './routes/risk-score.js';
import { mountRegistry } from './routes/registry.js';
import { mountAccessRequests } from './routes/access-requests.js';
import { mountWebhooks } from './routes/webhooks.js';
import { mountConnections } from './routes/connections.js';
import { mountInstallations } from './routes/installations.js';
import { mountSdk } from './routes/sdk.js';
import { mountLangfuseGateway } from './routes/langfuse-gateway.js';
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
await applyInitialSchema(db);
await seedAiPlatforms(db);
await seedDefaultRoutingRules(db);

const app = express();
app.use(cors());
// Bumped to 50mb to fit a single 25MB-cap event with base64 overhead (~1.33x).
// Per-event content is capped server-side in routes/dlp.js (MAX_CONTENT_BYTES).
app.use(express.json({ limit: '50mb' }));

app.get('/api/v1/health', (req, res) => {
  res.json({ ok: true, service: 'ai-governance-server', version: '0.1.0', dbKind: 'mongodb' });
});

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
mountRouting(app, db);
mountIdentity(app, db);
mountRiskScore(app, db);
mountRegistry(app, db);
mountAccessRequests(app, db);
mountWebhooks(app, db);
mountConnections(app, db);
mountInstallations(app, db);
mountSdk(app, db);
// Developer SDK ingestion gateway. Developers' Langfuse SDKs point at
// <server>/api/v1/lf with the credentials mountSdk issued; this relays to the
// real Langfuse Cloud project after stamping the per-project tenancy tag.
mountLangfuseGateway(app, db);

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

app.listen(PORT, () => {
  console.log(`AI Governance server listening on http://localhost:${PORT}`);
  console.log(`DB: MongoDB (${process.env.MONGODB_URI})`);
  if (!process.env.JWT_SECRET) {
    console.log(`\n[dev] JWT_SECRET (random per-process): ${JWT_SECRET}`);
    console.log(`[dev] ENROLL_SECRET: ${ENROLL_SECRET}`);
    console.log(`[dev] ADMIN_TOKEN: ${ADMIN_TOKEN}\n`);
  }
});
