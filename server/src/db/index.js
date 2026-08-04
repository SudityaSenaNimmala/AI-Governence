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

  // dlp_content
  await db.collection('dlp_content').createIndex({ event_id: 1 }, { unique: true });

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
