import { Router } from "express";
import crypto from "crypto";
import { getDataverseToken, getValidToken } from "../services/tokenManager.js";
import { DataverseClient } from "../services/dataverseClient.js";
import { getDb } from "../db.js";
import { decrypt } from "../crypto.js";
import { normalizeAgentScope } from "../agent-scope.js";
import { normalizeDlpMonitor, setDlpMonitor, listGovernedAgents } from "../dlp-monitor.js";
import type { GoogleServiceAccountKey } from "../services/googleWorkspaceClient.js";

const router = Router();

// ── Google service account token helper ──────────────────────────────────────

function createGoogleJwt(key: GoogleServiceAccountKey, scopes: string[]): string {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: key.client_email,
    scope: scopes.join(" "),
    aud: key.token_uri || "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  };
  const enc = (s: string) => Buffer.from(s).toString("base64url");
  const signingInput = `${enc(JSON.stringify(header))}.${enc(JSON.stringify(payload))}`;
  const pem = key.private_key.replace(/\\n/g, "\n").trim();
  const pemBody = pem.replace(/-----BEGIN PRIVATE KEY-----/g, "").replace(/-----END PRIVATE KEY-----/g, "").replace(/\s+/g, "");
  const privateKey = crypto.createPrivateKey({ key: Buffer.from(pemBody, "base64"), format: "der", type: "pkcs8" });
  const sign = crypto.createSign("RSA-SHA256");
  sign.update(signingInput, "utf8");
  return `${signingInput}.${sign.sign(privateKey, "base64url")}`;
}

async function getGoogleAccessToken(key: GoogleServiceAccountKey, scopes: string[]): Promise<string> {
  const jwt = createGoogleJwt(key, scopes);
  const res = await fetch(key.token_uri || "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }).toString(),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({})) as any;
    throw new Error(`Google token exchange failed: ${e.error_description || res.statusText}`);
  }
  const data = await res.json() as any;
  return data.access_token;
}

// ── Platform → Google delete base URL ────────────────────────────────────────

function googleDeleteUrl(platform: string, resourceName: string): string {
  if (platform === "reasoning_engine") {
    return `https://aiplatform.googleapis.com/v1/${resourceName}`;
  }
  if (platform === "notebooklm") {
    const location = resourceName.split("/locations/")[1]?.split("/")[0] || "global";
    // "global" has no regional subdomain — use the base endpoint directly
    const host = location === "global" ? "discoveryengine.googleapis.com" : `${location}-discoveryengine.googleapis.com`;
    return `https://${host}/v1alpha/${resourceName}`;
  }
  // agent_builder / dialogflow
  if (resourceName.includes("/agents/")) {
    const region = resourceName.split("/locations/")[1]?.split("/")[0] || "global";
    return `https://${region}-dialogflow.googleapis.com/v3/${resourceName}`;
  }
  // Discovery Engine apps (agent_builder) — must use v1alpha to match discovery API
  return `https://discoveryengine.googleapis.com/v1alpha/${resourceName}`;
}

/**
 * Suspend an agent by setting Dataverse statecode = 1 (Inactive)
 * Per PRD Section 4.3: Suspension is supported. Reversible. Logged.
 * Cannot permanently delete — admin must do that in Power Platform admin center.
 */
router.post("/suspend", async (req, res) => {
  try {
    const { oauth_key_id, bot_id, dataverse_env_url } = req.body;

    if (!oauth_key_id || !bot_id || !dataverse_env_url) {
      res.status(400).json({ error: "oauth_key_id, bot_id, and dataverse_env_url are required" });
      return;
    }

    const token = await getDataverseToken(oauth_key_id, dataverse_env_url);
    const client = new DataverseClient(token, dataverse_env_url);
    await client.suspendBot(bot_id);

    res.json({
      success: true,
      action: "suspended",
      botId: bot_id,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Suspension failed";
    console.error("Lifecycle suspend error:", message);
    res.status(500).json({ error: message });
  }
});

/**
 * Reactivate an agent by setting Dataverse statecode = 0 (Active)
 */
router.post("/reactivate", async (req, res) => {
  try {
    const { oauth_key_id, bot_id, dataverse_env_url } = req.body;

    if (!oauth_key_id || !bot_id || !dataverse_env_url) {
      res.status(400).json({ error: "oauth_key_id, bot_id, and dataverse_env_url are required" });
      return;
    }

    const token = await getDataverseToken(oauth_key_id, dataverse_env_url);
    const client = new DataverseClient(token, dataverse_env_url);
    await client.reactivateBot(bot_id);

    res.json({
      success: true,
      action: "reactivated",
      botId: bot_id,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Reactivation failed";
    console.error("Lifecycle reactivate error:", message);
    res.status(500).json({ error: message });
  }
});

// ── Google agent delete ───────────────────────────────────────────────────────

router.post("/google/delete", async (req, res) => {
  console.log("[Lifecycle] /google/delete hit — body:", JSON.stringify(req.body));
  try {
    const { google_oauth_key_id, agent_id, platform } = req.body as {
      google_oauth_key_id: string;
      agent_id: string;   // full GCP resource name, e.g. projects/P/locations/L/reasoningEngines/ID
      platform: string;
    };

    if (!google_oauth_key_id || !agent_id || !platform) {
      res.status(400).json({ error: "google_oauth_key_id, agent_id, and platform are required" });
      return;
    }

    const db = getDb();
    const keyDoc = await db.collection("oauth_keys").findOne({
      id: google_oauth_key_id,
      vendor: "google",
    });
    if (!keyDoc) {
      res.status(404).json({ error: "Google credentials not found" });
      return;
    }

    const serviceAccountKey: GoogleServiceAccountKey = JSON.parse(decrypt(keyDoc.client_secret));
    const token = await getGoogleAccessToken(serviceAccountKey, ["https://www.googleapis.com/auth/cloud-platform"]);

    // Strip leading slash, then strip frontend-added prefixes from AgentGovernance.jsx
    let resourceName = agent_id.startsWith("/") ? agent_id.slice(1) : agent_id;
    for (const prefix of ["vertex-agent-", "agent-builder-", "notebooklm-"]) {
      if (resourceName.startsWith(prefix)) { resourceName = resourceName.slice(prefix.length); break; }
    }
    const url = googleDeleteUrl(platform, resourceName);
    console.log(`[Lifecycle] google/delete → resourceName="${resourceName}" url="${url}"`);

    const deleteRes = await fetch(url, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!deleteRes.ok) {
      const body = await deleteRes.json().catch(() => ({})) as any;
      const msg = body?.error?.message || deleteRes.statusText;
      console.error(`[Lifecycle] google/delete failed ${deleteRes.status}:`, JSON.stringify(body));
      res.status(deleteRes.status).json({ error: `Google delete failed: ${msg}` });
      return;
    }

    res.json({ success: true, action: "deleted", agentId: agent_id, platform, timestamp: new Date().toISOString() });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Google delete failed";
    console.error("Lifecycle google/delete error:", message);
    res.status(500).json({ error: message });
  }
});

// ── OpenAI assistant delete ───────────────────────────────────────────────────

router.post("/openai/delete", async (req, res) => {
  try {
    const { openai_oauth_key_id, assistant_id } = req.body as {
      openai_oauth_key_id: string;
      assistant_id: string;
    };

    if (!openai_oauth_key_id || !assistant_id) {
      res.status(400).json({ error: "openai_oauth_key_id and assistant_id are required" });
      return;
    }

    const db = getDb();
    const keyDoc = await db.collection("oauth_keys").findOne({
      id: openai_oauth_key_id,
      vendor: "openai",
    });
    if (!keyDoc) {
      res.status(404).json({ error: "OpenAI credentials not found" });
      return;
    }

    const apiKey = decrypt(keyDoc.client_secret);
    const orgId = keyDoc.tenant_id;

    const headers: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
      "OpenAI-Beta": "assistants=v2",
    };
    if (orgId) headers["OpenAI-Organization"] = orgId;

    const deleteRes = await fetch(`https://api.openai.com/v1/assistants/${assistant_id}`, {
      method: "DELETE",
      headers,
    });

    if (!deleteRes.ok) {
      const body = await deleteRes.json().catch(() => ({})) as any;
      const msg = body?.error?.message || deleteRes.statusText;
      res.status(deleteRes.status).json({ error: `OpenAI delete failed: ${msg}` });
      return;
    }

    res.json({ success: true, action: "deleted", assistantId: assistant_id, timestamp: new Date().toISOString() });
  } catch (err) {
    const message = err instanceof Error ? err.message : "OpenAI delete failed";
    console.error("Lifecycle openai/delete error:", message);
    res.status(500).json({ error: message });
  }
});

// ── Soft suspend (Google / OpenAI — governance record only) ──────────────────

// No need for ALTER TABLE — MongoDB collections are schema-less

router.post("/soft-suspend", async (req, res) => {
  try {
    const { bot_id, name, oauth_key_id } = req.body as { bot_id: string; name?: string; oauth_key_id?: string };
    if (!bot_id) { res.status(400).json({ error: "bot_id is required" }); return; }
    const db = getDb();
    await db.collection("agent_registry").updateOne(
      { bot_id },
      {
        $set: {
          lifecycle_status: "suspended",
          oauth_key_id: oauth_key_id || null,
          name: name || null,
          updated_at: new Date(),
        },
        $setOnInsert: {
          bot_id,
          created_at: new Date(),
        },
      },
      { upsert: true }
    );
    res.json({ success: true, botId: bot_id, lifecycleStatus: "suspended" });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Soft suspend failed" });
  }
});

router.post("/soft-reactivate", async (req, res) => {
  try {
    const { bot_id, name, oauth_key_id } = req.body as { bot_id: string; name?: string; oauth_key_id?: string };
    if (!bot_id) { res.status(400).json({ error: "bot_id is required" }); return; }
    const db = getDb();
    await db.collection("agent_registry").updateOne(
      { bot_id },
      {
        $set: {
          lifecycle_status: "active",
          oauth_key_id: oauth_key_id || null,
          name: name || null,
          updated_at: new Date(),
        },
        $setOnInsert: {
          bot_id,
          created_at: new Date(),
        },
      },
      { upsert: true }
    );
    res.json({ success: true, botId: bot_id, lifecycleStatus: "active" });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Soft reactivate failed" });
  }
});

router.get("/lifecycle-statuses", async (_req, res) => {
  try {
    const db = getDb();
    const rows = await db.collection("agent_registry")
      .find({ lifecycle_status: "suspended" }, { projection: { _id: 0, bot_id: 1, lifecycle_status: 1 } })
      .toArray();
    const statuses: Record<string, string> = {};
    for (const row of rows) statuses[row.bot_id] = row.lifecycle_status;
    res.json({ statuses });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to load lifecycle statuses" });
  }
});

// ── Approval status GET / PUT ─────────────────────────────────────────────────

router.get("/approval-statuses", async (_req, res) => {
  try {
    const db = getDb();
    const rows = await db.collection("agent_registry")
      .find(
        { approval_status: { $ne: null, $nin: [null, "no_status"] } },
        { projection: { _id: 0, bot_id: 1, approval_status: 1 } }
      )
      .toArray();
    const statuses: Record<string, string> = {};
    for (const row of rows) statuses[row.bot_id] = row.approval_status;
    res.json({ statuses });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to load approval statuses" });
  }
});

router.put("/approval-status", async (req, res) => {
  try {
    const { bot_id, approval_status, name, oauth_key_id } = req.body as {
      bot_id: string;
      approval_status: string;
      name?: string;
      oauth_key_id?: string;
    };

    if (!bot_id || !approval_status) {
      res.status(400).json({ error: "bot_id and approval_status are required" });
      return;
    }

    const db = getDb();
    await db.collection("agent_registry").updateOne(
      { bot_id },
      {
        $set: {
          approval_status,
          oauth_key_id: oauth_key_id || null,
          name: name || null,
          updated_at: new Date(),
        },
        $setOnInsert: {
          bot_id,
          created_at: new Date(),
        },
      },
      { upsert: true }
    );

    res.json({ success: true, botId: bot_id, approvalStatus: approval_status });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to update approval status" });
  }
});

// ── Teams app org-wide block / unblock ───────────────────────────────────────
// Requires AppCatalog.ReadWrite.All (admin consent) on the Azure app registration

// DELETE a Teams org-catalog app permanently (removes for all users org-wide)
// Requires AppCatalog.ReadWrite.All (Application, admin consent)
router.post("/teams/delete", async (req, res) => {
  try {
    const { oauth_key_id, app_id, name } = req.body as { oauth_key_id: string; app_id: string; name?: string };
    if (!oauth_key_id || !app_id) {
      res.status(400).json({ error: "oauth_key_id and app_id are required" });
      return;
    }

    const token = await getValidToken(oauth_key_id, "graph");

    console.log(`[Teams Delete] Deleting app ${app_id} (${name || "unnamed"}) from org catalog`);

    // Try v1.0 first, fall back to beta if 403
    let deleteRes = await fetch(`https://graph.microsoft.com/v1.0/appCatalogs/teamsApps/${app_id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });

    if (deleteRes.status === 403) {
      console.log(`[Teams Delete] v1.0 returned 403, retrying with beta endpoint`);
      deleteRes = await fetch(`https://graph.microsoft.com/beta/appCatalogs/teamsApps/${app_id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
    }

    // 204 No Content = success; 404 = already gone (treat as success)
    if (!deleteRes.ok && deleteRes.status !== 204 && deleteRes.status !== 404) {
      const body = await deleteRes.json().catch(() => ({})) as any;
      const msg = body?.error?.message || deleteRes.statusText;
      console.error(`[Teams Delete] Graph error ${deleteRes.status}:`, msg);
      res.status(deleteRes.status).json({ error: `Teams app delete failed: ${msg}` });
      return;
    }

    // Remove from governance registry if present
    const db = getDb();
    await db.collection("agent_registry").deleteOne({ bot_id: app_id }).catch(() => {});

    console.log(`[Teams Delete] Successfully deleted ${app_id}`);
    res.json({ success: true, appId: app_id, action: "deleted" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Teams delete failed";
    console.error("[Teams Delete] Error:", msg);
    res.status(500).json({ error: msg });
  }
});

// ── Temp: clear cached graph tokens so new permissions take effect ────────────
router.delete("/clear-token-cache", async (_req, res) => {
  const db = getDb();
  const result = await db.collection("tokens").deleteMany({ scope: "graph" });
  res.json({ deleted: result.deletedCount, message: "Graph token cache cleared" });
});

// ── Block / Unblock agents ──────────────────────────────────────────────────
// Stores a blocklist in MongoDB. The browser extension and OS monitor poll
// GET /api/blocked-agents to enforce blocks at runtime.

router.post("/block", async (req, res) => {
  try {
    const { agent_id, agent_name, platform, reason, oauth_key_id, agent_scope } = req.body;
    if (!agent_id) {
      res.status(400).json({ error: "agent_id is required" });
      return;
    }
    // How wide the block is — see ../agent-scope.ts. Optional and defaulting to
    // null (platform-wide, i.e. exactly today's behaviour), but an UNRECOGNISED
    // value is refused rather than coerced: silently defaulting a typo either way
    // would misrepresent the admin's decision.
    const scope = normalizeAgentScope(agent_scope);
    if (scope === undefined) {
      res.status(400).json({ error: "agent_scope must be 'agent', 'platform', or omitted" });
      return;
    }
    const db = getDb();
    await db.collection("blocked_agents").updateOne(
      { agent_id },
      {
        $set: {
          agent_id,
          agent_name: agent_name || null,
          platform: platform || null,
          reason: reason || "Blocked by admin",
          // Provenance, so a block can be attributed to the connection it came
          // from. Rows written before this have none, which is why the read path
          // falls back to checking whether the agent still appears in any scan.
          oauth_key_id: oauth_key_id || null,
          agent_scope: scope,
          blocked: true,
          blocked_at: new Date(),
          unblocked_at: null,
        },
      },
      { upsert: true },
    );
    res.json({ ok: true, agent_id, status: "blocked" });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Block failed" });
  }
});

router.post("/unblock", async (req, res) => {
  try {
    const { agent_id } = req.body;
    if (!agent_id) {
      res.status(400).json({ error: "agent_id is required" });
      return;
    }
    const db = getDb();
    await db.collection("blocked_agents").updateOne(
      { agent_id },
      { $set: { blocked: false, unblocked_at: new Date() } },
    );
    res.json({ ok: true, agent_id, status: "unblocked" });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unblock failed" });
  }
});

// Public endpoint — no auth required so the browser extension can poll it.
router.get("/blocked-agents", async (_req, res) => {
  try {
    const db = getDb();
    const list = await db.collection("blocked_agents")
      .find({ blocked: true })
      // agent_scope is part of the projection because it is ENFORCEMENT input,
      // not metadata: the desktop agent's blocked-agents.json is built from this
      // payload, and a row whose scope never reaches the enforcer is a row that
      // silently blocks the whole app.
      .project({ _id: 0, agent_id: 1, agent_name: 1, platform: 1, reason: 1, blocked_at: 1, oauth_key_id: 1, agent_scope: 1 })
      .toArray();

    // Flag blocks whose agent no longer appears in any scan, WITHOUT removing them.
    //
    // This list is what the browser extension enforces against, so filtering it is
    // the one change that must not be made here: dropping a row silently lifts a
    // block an admin deliberately applied. A block outliving its connection is
    // correct behaviour — the agent may still be reachable even if we stopped
    // scanning the tenant that revealed it.
    //
    // What was actually wrong is that such rows were indistinguishable from live
    // ones, so a block on an agent from a Google connection removed in June sat in
    // the UI forever with nothing to indicate it was unmanageable. Marked, not
    // deleted; clearing one stays an explicit admin action via /unblock.
    const ids = list.map(b => b.agent_id).filter(Boolean);
    const known = new Set<string>();
    if (ids.length > 0) {
      const rows = await db.collection("discovered_agents")
        .find({ $or: [{ id: { $in: ids } }, { agent_key: { $in: ids } }] })
        .project({ _id: 0, id: 1, agent_key: 1 })
        .toArray();
      for (const r of rows) {
        if (r.id) known.add(String(r.id));
        if (r.agent_key) known.add(String(r.agent_key));
      }
    }

    res.json(list.map(b => ({ ...b, orphaned: !known.has(String(b.agent_id)) })));
  } catch (err) {
    res.json([]);
  }
});

// ── DLP-monitor agents — governed, but NOT blocked ──────────────────────────
// A second, independent flag on the same `blocked_agents` row. See
// ../dlp-monitor.ts for why this state exists and why blocked always wins over
// it. The write shape, the filter and the projection all live there so they have
// one definition and can be tested without a Mongo connection.

router.post("/dlp-monitor", async (req, res) => {
  try {
    const { agent_id, agent_name, platform, reason, oauth_key_id, agent_scope, dlp_monitor } = req.body;
    if (!agent_id) {
      res.status(400).json({ error: "agent_id is required" });
      return;
    }
    // Explicit boolean, no default — an empty body must not start (or stop)
    // monitoring an agent by accident.
    const monitor = normalizeDlpMonitor(dlp_monitor);
    if (monitor === undefined) {
      res.status(400).json({ error: "dlp_monitor must be true or false" });
      return;
    }
    // Same enum and same refusal-rather-than-coercion as /block.
    const scope = normalizeAgentScope(agent_scope);
    if (scope === undefined) {
      res.status(400).json({ error: "agent_scope must be 'agent', 'platform', or omitted" });
      return;
    }
    const result = await setDlpMonitor(getDb(), {
      agent_id,
      dlp_monitor: monitor,
      // Passed through only when the caller actually supplied them; omitted keys
      // stay untouched on an existing row rather than being blanked.
      ...(agent_name === undefined ? {} : { agent_name }),
      ...(platform === undefined ? {} : { platform }),
      ...(reason === undefined ? {} : { reason }),
      ...(oauth_key_id === undefined ? {} : { oauth_key_id }),
      ...(agent_scope === undefined ? {} : { agent_scope: scope }),
    });
    res.json({
      ok: true,
      agent_id,
      dlp_monitor: monitor,
      status: monitor ? "dlp_monitored" : "dlp_monitor_cleared",
      // Honest about whether anything was actually written: clearing the flag
      // never creates a row, so a call naming an unknown agent matches nothing.
      matched: result.matched,
      created: result.created,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "dlp_monitor update failed" });
  }
});

// Public endpoint — no auth required, exactly like /blocked-agents above, because
// the same two unauthenticated consumers (the desktop agent and the browser
// extension) poll it. Disjoint from /blocked-agents by construction: a blocked
// agent is never returned here.
router.get("/governed-agents", async (_req, res) => {
  try {
    res.json(await listGovernedAgents(getDb()));
  } catch (err) {
    res.json([]);
  }
});

export default router;
