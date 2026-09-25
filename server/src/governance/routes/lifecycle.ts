import { Router } from "express";
import crypto from "crypto";
import { getDataverseToken, getValidToken } from "../services/tokenManager.js";
import { DataverseClient } from "../services/dataverseClient.js";
import { getDb } from "../db.js";
import { decrypt } from "../crypto.js";
import { normalizeAgentScope } from "../agent-scope.js";
import { normalizeDlpMonitor, setDlpMonitor, listGovernedAgents, lookupAgentIdentity, aliasesFor } from "../dlp-monitor.js";
import { derivePlatform, normalizePlatform } from "../../lib/agent-platform.js";
// `unenforceableReason` SUPERSEDES agent-platform.js's isUnenforceableBlock at
// both call sites below: it answers the same "no platform" question and one more
// ("platform set, but no surface knows it"). Imported from the one place that
// owns the enforceable set so the read path and the write path cannot disagree
// about which stored rows actually do something.
import { unenforceableReason } from "../../lib/agent-platforms.js";
// The SAME admin credential the SDK, replay, conversation and feature-settings
// routes already use — one admin auth mechanism in the product, not two. Applied
// below to /block, /unblock and /dlp-monitor only; the GETs on this router stay public because
// the browser extension and the desktop agent poll them with no token at all.
import { requireAdminAuth } from "../../auth.js";
import type { GoogleServiceAccountKey } from "../services/googleWorkspaceClient.js";

const router = Router();

// ── Request-body type checking for the blocklist writes ─────────────────────
//
// THE HOLE THIS CLOSES. `agent_id` was checked for TRUTHINESS only, and
// express.json() hands back whatever JSON shape the client sent — including an
// object. A body of `{"agent_id": {"$ne": null}}` passed `if (!agent_id)` and went
// straight into `updateOne({ agent_id }, …, { upsert: true })`, where Mongo reads
// it as a QUERY OPERATOR rather than a value: the filter matches the first row
// whose agent_id is not null and the $set overwrites an UNRELATED agent's block
// row — silently repointing or lifting a decision the admin never touched. The
// same value also builds the `$or` handed to derivePlatform().
//
// So every field that reaches a Mongo filter or a stored row is type-checked as a
// string first. The optional ones may still be omitted or sent as null — the write
// path already normalises those to null — what is refused is a value of the wrong
// TYPE, which no legitimate caller sends.
const OPTIONAL_STRING_FIELDS = ["agent_name", "platform", "reason", "oauth_key_id"] as const;

/**
 * The name of the first badly-typed field, or null when the body is acceptable.
 *
 * EXPORTED FOR TESTS. The rest of this router cannot be mounted against the
 * in-memory fake (it resolves its Mongo handle through getDb() at request time),
 * so its behaviour is normally pinned by reading this file's source — which
 * cannot tell a working check from a broken one. This one function is pure, so
 * exporting it buys a real behavioural test of the injection it refuses.
 */
export function badBlockField(body: any): string | null {
  // Required, and non-empty after trimming — preserving the old `if (!agent_id)`
  // rejection of "" while adding the type it always assumed.
  if (typeof body?.agent_id !== "string" || body.agent_id.trim().length === 0) return "agent_id";
  for (const field of OPTIONAL_STRING_FIELDS) {
    const value = body[field];
    if (value === undefined || value === null) continue;
    if (typeof value !== "string") return field;
  }
  return null;
}

/** The 400 body for a badly-typed field, worded the same way on both routes. */
function badFieldError(field: string): { error: string } {
  return field === "agent_id"
    ? { error: "agent_id is required and must be a string" }
    : { error: `${field} must be a string when present` };
}

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

// ADMIN-GATED. This route writes the list BOTH enforcers act on, so an open
// version let anyone who could reach the API block — or, via /unblock, lift —
// any agent in the org. The GETs below stay public by design.
router.post("/block", requireAdminAuth, async (req, res) => {
  try {
    const { agent_id, agent_name, platform, reason, oauth_key_id, agent_scope } = req.body;
    // Type-checked BEFORE any of these values reaches a Mongo filter, a stored
    // field, or derivePlatform() — see badBlockField at the top of this file for
    // the injection it exists to stop.
    const badField = badBlockField(req.body);
    if (badField) {
      res.status(400).json(badFieldError(badField));
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
    // Same platform derivation as PUT /api/v1/registry/:id/status, through the
    // same helper, so the two write paths cannot disagree about it. A row stored
    // with platform:null is enforceable on NEITHER surface (the desktop enforcer
    // drops it at parse time, the extension cannot map it to a host), so the value
    // is taken off the discovered_agents document for this agent when the caller
    // omits it. See ../../lib/agent-platform.js.
    const resolvedPlatform = normalizePlatform(platform)
      ?? await derivePlatform(db, { $or: [{ id: agent_id }, { agent_key: agent_id }, { botId: agent_id }, { appId: agent_id }] });
    await db.collection("blocked_agents").updateOne(
      { agent_id },
      {
        $set: {
          agent_id,
          agent_name: agent_name || null,
          platform: resolvedPlatform,
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
    // The block is stored either way — dropping it would lift a decision an admin
    // deliberately made — but a row that enforces nowhere is reported as such
    // rather than handed a plain success. Mirrors the registry route's
    // `enforced:false` + `reason`, and the `unenforceable` / `unenforceable_reason`
    // markers GET /blocked-agents puts on the same row.
    //
    // THREE ways a stored row enforces nowhere by name, and they are different
    // facts:
    //   no_platform            — nothing to key on. The original case.
    //   unknown_platform       — a platform IS set, but neither the extension's
    //                            host map nor the desktop enforcer's process map
    //                            knows it (see ../../lib/agent-platforms.js).
    //                            Previously came back as a plain success and
    //                            looked identical to a working block.
    //   product_level_platform — the platform names a PRODUCT (m365_copilot,
    //                            teams_desktop) rather than a per-agent-matchable
    //                            value. That product IS blocked, by the separate
    //                            whole-product ai_platforms host cascade — this
    //                            name-matched row just is not what does it.
    //
    // All three are INFORMATIONAL and handled identically; none is a harder
    // failure than the others, and NONE refuses the write. The row above is already committed at this point,
    // on purpose: an admin's decision outranks our ability to act on it, and a
    // platform we cannot enforce today may be enforceable after the next endpoint
    // update — at which point the stored row starts working with no re-entry.
    // Named for what it is, not `reason` — `reason` in this scope is the ADMIN'S
    // free-text justification off the request body, already stored on the row above.
    const enforcementReason = unenforceableReason(resolvedPlatform);
    res.json({
      ok: true,
      agent_id,
      status: "blocked",
      ...(enforcementReason ? { enforced: false, reason: enforcementReason } : {}),
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Block failed" });
  }
});

// ADMIN-GATED for the same reason as /block, and arguably more urgently: this one
// LIFTS a governance decision, and an unauthenticated caller able to lift a block
// is an unauthenticated caller able to re-enable any AI tool in the org.
router.post("/unblock", requireAdminAuth, async (req, res) => {
  try {
    const { agent_id } = req.body;
    // IDENTICAL shape to /block's filter, so it gets the identical check: the
    // `{"$ne": null}` body that repointed a block through /block would, here, have
    // matched an unrelated row and set blocked:false on it — lifting someone
    // else's block. `agent_id` is the only field this route reads.
    if (typeof agent_id !== "string" || agent_id.trim().length === 0) {
      res.status(400).json(badFieldError("agent_id"));
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
    //
    // `agent_aliases` rides the same lookup: see lookupAgentIdentity's comment for
    // why one stored name isn't enough for the desktop enforcer to match against.
    const { known, namesById } = await lookupAgentIdentity(db, list.map(b => b.agent_id));

    // `unenforceable` rides the same annotate-never-drop rule as `orphaned`, for a
    // different failure: the row exists and is real, but no surface can act on it,
    // so it shows as Blocked in AI Systems while stopping nothing.
    //
    // THREE causes, now told apart by `unenforceable_reason` instead of collapsed
    // into one boolean (see ../../lib/agent-platforms.js for the shared definition
    // and the curated enforceable set):
    //
    //   'no_platform'      — no `platform` at all. Both consumers key on that
    //                        field: the desktop enforcer drops a platform-less row
    //                        at parse time, the extension cannot map it to a host.
    //                        Both write paths derive the platform now, so this
    //                        should only be rows written before that fix.
    //   'unknown_platform' — a platform IS set, but it is not one any surface
    //                        knows. Previously reported as enforceable, which is
    //                        the gap this widening closes: an admin blocking, say,
    //                        a `power_automate` or `aws_bedrock` agent got a row
    //                        that looked indistinguishable from a working block.
    //   'product_level_platform' — the platform names a PRODUCT (m365_copilot,
    //                        teams_desktop), which the whole-product ai_platforms
    //                        host cascade does block; this per-agent, name-matched
    //                        row is simply not the thing doing it.
    //
    // ADDITIVE ONLY. `unenforceable` stays a boolean and keeps its meaning for the
    // clients already reading it — it just becomes true for more rows — and no row
    // is dropped. Filtering here would be the one unforgivable change: it would
    // make the payload agree with what is actually enforced by silently discarding
    // the admin's decision. Marked, never migrated or deleted.
    res.json(list.map(b => {
      const unenforceableReasonForRow = unenforceableReason(b.platform);
      return {
        ...b,
        orphaned: !known.has(String(b.agent_id)),
        unenforceable: unenforceableReasonForRow !== null,
        unenforceable_reason: unenforceableReasonForRow,
        agent_aliases: aliasesFor(b.agent_id, b.agent_name, namesById),
      };
    }));
  } catch (err) {
    // Must never resolve as an empty success list. This route's whole point is
    // "which agents are currently blocked", and its two consumers — the desktop
    // enforcer
    // (blocked-agents-sync.js) and the browser extension — both treat an empty
    // array as an authoritative "nothing is blocked" and write it straight into
    // their local enforcement file. A DB hiccup here would therefore have
    // silently unblocked every agent in the company, indistinguishable from an
    // admin genuinely clearing every block. A real error status is what lets
    // the consumers' OWN existing fail-closed check do its job: the desktop
    // sync already does `if (!res.ok) return null` and leaves its file
    // untouched on exactly this signal (see blocked-agents-sync.js's
    // `refreshBlockedAgents` and its "FAIL CLOSED on either source failing"
    // comment) — it just never had a real failure status to catch here before.
    res.status(500).json({ error: err instanceof Error ? err.message : "Could not read blocked-agents" });
  }
});

// ── DLP-monitor agents — governed, but NOT blocked ──────────────────────────
// A second, independent flag on the same `blocked_agents` row. See
// ../dlp-monitor.ts for why this state exists and why blocked always wins over
// it. The write shape, the filter and the projection all live there so they have
// one definition and can be tested without a Mongo connection.

//
// ADMIN-GATED, like /block and /unblock: this flag changes what the desktop agent
// and the browser extension enforce for every user of the named agent, so an open
// write let anyone who could reach the API start or stop DLP monitoring of it.
// GET /governed-agents below stays public — the enforcers poll it with no token.
router.post("/dlp-monitor", requireAdminAuth, async (req, res) => {
  try {
    const { agent_id, agent_name, platform, reason, oauth_key_id, agent_scope, dlp_monitor } = req.body;
    // Type-checked with the SAME helper /block uses, BEFORE agent_id reaches the
    // Mongo filter in the shared write helper. The old `if (!agent_id)` let
    // `{"agent_id": {"$ne": null}}` through, which Mongo reads as a query operator
    // and which would then toggle monitoring on an unrelated agent's row. The
    // optional identity fields are held to the same "string when present" rule,
    // because they land in the stored row's $set.
    const badField = badBlockField(req.body);
    if (badField) {
      res.status(400).json(badFieldError(badField));
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
