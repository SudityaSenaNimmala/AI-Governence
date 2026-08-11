// DAL — MongoDB backend.
//
// openDb()            → connects to MongoDB, returns the Db instance
// applyInitialSchema  → creates indexes (collections are created implicitly)
// toolKeyFor          → stable identifier for one logical AI tool

import { connectMongo, getMongo } from './mongodb.js';

export async function openDb() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI env var is required');
  await connectMongo(uri);
  return getMongo();
}

export async function applyInitialSchema(db) {
  // Collections are created implicitly on first insert. We only need indexes.

  // machines
  await db.collection('machines').createIndex({ id: 1 }, { unique: true });

  // scans
  await db.collection('scans').createIndex({ machine_id: 1, received_at: -1 });

  // findings
  await db.collection('findings').createIndex({ scan_id: 1 });
  await db.collection('findings').createIndex({ machine_id: 1 });
  await db.collection('findings').createIndex({ tool_key: 1 });
  await db.collection('findings').createIndex({ detected_at: -1 });

  // sanctions
  await db.collection('sanctions').createIndex({ tool_key: 1 }, { unique: true });

  // dlp_events
  await db.collection('dlp_events').createIndex({ machine_id: 1 });
  await db.collection('dlp_events').createIndex({ occurred_at: -1 });
  await db.collection('dlp_events').createIndex({ ai_service: 1 });
  await db.collection('dlp_events').createIndex({ secret_class: 1 });
  await db.collection('dlp_events').createIndex({ event_kind: 1 });
  // Replay a conversation in order: filter by session, then order by time.
  // (client_seq is the tie-breaker the reader applies, occurred_at is the index.)
  await db.collection('dlp_events').createIndex({ session_id: 1, occurred_at: 1 });
  // Replay ONE of the AI site's own conversations in order, across every session
  // that touched it. Scoped by machine because the conversation id is minted by
  // the AI site, not by us: two machines can legitimately hold the same id
  // (a shared chat), and they must never merge into one conversation view.
  // Events stored before this shipped simply lack the field, so they are never
  // grouped — the same terminal state as a site we can extract no conversation
  // id from at all. There is no migration for them. There IS a narrow,
  // forward-only backfill for the one case the client genuinely cannot stamp at
  // emit time — the first turn of a brand-new chat, sent before the site minted
  // the id — which adopts still-null events of the SAME session once that id
  // arrives (backfillConversationId in routes/dlp.js). It runs off the
  // {session_id, occurred_at} index above and never touches a non-null value.
  await db.collection('dlp_events').createIndex({ machine_id: 1, external_conv_id: 1, occurred_at: 1 });

  // monitored_servers — server-monitor enrollments (separate from desktop machines)
  await db.collection('monitored_servers').createIndex({ id: 1 }, { unique: true });
  await db.collection('monitored_servers').createIndex({ status: 1 });

  // ai_sessions — one doc per conversation (browser extension session_id)
  await db.collection('ai_sessions').createIndex({ session_id: 1 }, { unique: true });
  await db.collection('ai_sessions').createIndex({ machine_id: 1, started_at: -1 });
  // "Every sitting that touched this conversation, oldest first" — the visits
  // lookup of the conversation detail route (routes/conversations.js). Multikey
  // on external_conv_ids, because one session legitimately spans several chats.
  // Scoped by machine for the same reason the dlp_events index above is: the id
  // is minted by the AI site, so two machines can hold the same one. Without
  // this the route falls back to the {machine_id, started_at} index and filters
  // that machine's ENTIRE session history in memory, which is the opposite of
  // the "direct, indexed lookups" its own comment claims.
  await db.collection('ai_sessions').createIndex({ machine_id: 1, external_conv_ids: 1, started_at: 1 });

  // dlp_content
  await db.collection('dlp_content').createIndex({ event_id: 1 }, { unique: true });

  // session_recordings — one doc per capture run (Session Replay). Reused across
  // both capture phases and discriminated by `capture`: 'dom_events' for the
  // current rrweb DOM/interaction recording, 'tab_video' for the retired video
  // phase (those rows survive only as audit tombstones — see
  // scripts/cleanup-video-recordings.mjs). A run can span several conversations,
  // so the conversation ids it covers live in a `session_ids` array rather than a
  // single scalar column.
  await db.collection('session_recordings').createIndex({ recording_id: 1 }, { unique: true });
  await db.collection('session_recordings').createIndex({ machine_id: 1, started_at: -1 });
  // "Which replays cover this conversation" — the multikey index makes the array
  // containment lookup on the session detail route an index hit.
  await db.collection('session_recordings').createIndex({ session_ids: 1, started_at: 1 });
  // "Which runs cover this conversation, oldest first" — the conversation view's
  // own lookup. A run is scoped to at most one conversation (it ends when the
  // tab moves to another chat), so this is a plain scalar index.
  await db.collection('session_recordings').createIndex({ external_conv_id: 1, started_at: 1 });
  // Drives the retention sweeper. Deliberately NOT a TTL index: TTL would delete
  // this run doc — the audit tombstone — and leave its chunk documents behind with
  // nothing pointing at them. The sweeper in lib/replay-retention.js reads this
  // index, deletes the chunks, and leaves the run doc behind.
  await db.collection('session_recordings').createIndex({ expires_at: 1 });

  // session_replay_chunks — the uploaded event chunks of a DOM replay run. Each
  // doc holds a gzipped JSON array of rrweb events INLINE in `payload` (no GridFS;
  // a chunk is capped at 256 KB gzipped). The unique key is both the idempotency
  // guarantee for a retried upload and the natural index for the ordered read.
  await db.collection('session_replay_chunks').createIndex(
    { recording_id: 1, seq: 1 },
    { unique: true },
  );

  // server_agent_calls
  await db.collection('server_agent_calls').createIndex({ occurred_at: -1 });
  await db.collection('server_agent_calls').createIndex({ machine_id: 1 });
  await db.collection('server_agent_calls').createIndex({ user: 1 });
  await db.collection('server_agent_calls').createIndex({ provider: 1 });

  // server_agent_signals
  await db.collection('server_agent_signals').createIndex({ occurred_at: -1 });
  await db.collection('server_agent_signals').createIndex({ machine_id: 1 });

  // discovered_apps
  await db.collection('discovered_apps').createIndex({ host: 1 }, { unique: true });

  // runtime_classifications
  await db.collection('runtime_classifications').createIndex({ host: 1 }, { unique: true });

  // classification_audit
  await db.collection('classification_audit').createIndex({ host: 1 });
  await db.collection('classification_audit').createIndex({ created_at: -1 });

  // tool_usage
  await db.collection('tool_usage').createIndex(
    { machine_id: 1, tool_key: 1 },
    { unique: true },
  );

  // ai_platforms
  await db.collection('ai_platforms').createIndex({ host: 1 }, { unique: true });
  await db.collection('ai_platforms').createIndex({ updated_at: -1 });

  // routing_rules
  await db.collection('routing_rules').createIndex({ id: 1 }, { unique: true });
  await db.collection('routing_rules').createIndex({ priority: 1 });

  // routing_endpoints
  await db.collection('routing_endpoints').createIndex({ id: 1 }, { unique: true });

  // routing_log
  await db.collection('routing_log').createIndex({ timestamp: -1 });
  await db.collection('routing_log').createIndex({ machine_id: 1 });
  await db.collection('routing_log').createIndex({ rule_id: 1 });

  // risk_scores (historical)
  await db.collection('risk_scores').createIndex({ profile_id: 1, computed_at: -1 });

  // integrations (connections)
  await db.collection('integrations').createIndex({ type: 1 }, { unique: true });

  // webhooks
  await db.collection('webhooks').createIndex({ id: 1 }, { unique: true });
  await db.collection('webhook_log').createIndex({ timestamp: -1 });
  await db.collection('webhook_log').createIndex({ webhook_id: 1 });

  // access_requests
  await db.collection('access_requests').createIndex({ id: 1 }, { unique: true });
  await db.collection('access_requests').createIndex({ machine_id: 1, tool_host: 1 });
  await db.collection('access_requests').createIndex({ status: 1 });

  // access_exceptions
  await db.collection('access_exceptions').createIndex({ machine_id: 1, tool_host: 1 });
  await db.collection('access_exceptions').createIndex({ expires_at: 1 });

  // sdk_projects — Developer SDK projects, i.e. the per-developer Langfuse
  // credential pairs this server mints (routes/sdk.js). These indexes did not
  // exist while the collection was created implicitly on first insert, which
  // left the gateway's hot path — "look up the project for this public key on
  // every ingestion request" — as a collection scan, and left nothing enforcing
  // that a minted public key is unique.
  await db.collection('sdk_projects').createIndex({ id: 1 }, { unique: true });
  await db.collection('sdk_projects').createIndex({ public_key: 1 }, { unique: true });
  await db.collection('sdk_projects').createIndex({ created_at: -1 });

  // ── Local tracing store (CFAI_TRACING_BACKEND=local) ───────────────────────
  // The developer SDK's traces when they are stored HERE rather than relayed to
  // Langfuse Cloud. Parent (lf_traces) / child (lf_observations) / raw content
  // (lf_observation_io), the same three-way split dlp_events / dlp_content uses:
  // metadata and masked previews in one collection, unmasked prompt and
  // completion text in another that only an admin route can read, and only when
  // the project set capture_content.

  // lf_traces — one doc per trace. {project_id, id} is the upsert key that makes
  // Langfuse's create-then-update protocol converge on one document.
  await db.collection('lf_traces').createIndex({ project_id: 1, id: 1 }, { unique: true });
  await db.collection('lf_traces').createIndex({ project_id: 1, timestamp: -1 });
  await db.collection('lf_traces').createIndex({ project_id: 1, user_id: 1, timestamp: -1 });
  // Drives the retention sweeper (lib/tracing-retention.js). Deliberately NOT a
  // TTL index: TTL would delete the trace and leave its lf_observations children
  // — and their lf_observation_io content rows — behind with nothing pointing at
  // them. The sweep deletes children first, parent last.
  await db.collection('lf_traces').createIndex({ expires_at: 1 });

  // lf_observations — spans, generations and events in ONE collection with a
  // `type` discriminator, which is how Langfuse itself models them.
  await db.collection('lf_observations').createIndex({ project_id: 1, id: 1 }, { unique: true });
  await db.collection('lf_observations').createIndex({ project_id: 1, trace_id: 1, start_time: 1 });
  await db.collection('lf_observations').createIndex({ project_id: 1, type: 1, start_time: -1 });
  await db.collection('lf_observations').createIndex({ trace_id: 1 });
  await db.collection('lf_observations').createIndex({ expires_at: 1 });

  // lf_observation_io — raw input/output. Written ONLY for projects with
  // capture_content: true, read only through the admin-gated
  // GET /api/v1/tracing/observations/:id/io.
  await db.collection('lf_observation_io').createIndex(
    { project_id: 1, observation_id: 1 },
    { unique: true },
  );
  await db.collection('lf_observation_io').createIndex({ expires_at: 1 });

  // employee_profiles
  await db.collection('employee_profiles').createIndex({ id: 1 }, { unique: true });
  await db.collection('employee_profiles').createIndex({ resolve_key: 1 }, { unique: true });
  await db.collection('employee_profiles').createIndex({ machine_ids: 1 });
  await db.collection('employee_profiles').createIndex({ email: 1 });
}

// Stable identifier for one logical AI tool, e.g. "openai:chatgpt".
// Lets the dashboard join findings from different detectors into one row.
export function toolKeyFor(finding) {
  const vendor = (finding.vendor || finding.provider || 'unknown')
    .toLowerCase().replace(/\s+/g, '-');
  const product = (finding.product || finding.appId || finding.extensionId ||
                   finding.serverName || finding.runtime || finding.type)
    .toString().toLowerCase().replace(/\s+/g, '-');
  return `${vendor}:${product}`;
}
