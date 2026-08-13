/**
 * Interactive Power Platform provisioning — "sign in once, we do the rest".
 *
 * The admin-consent flow in msOAuth.ts yields an APP-ONLY token, which is all the
 * Graph scanning needs. It is not enough for Copilot Studio: registering a
 * management application and creating Dataverse application users are gated behind
 * an admin USER identity, because an app able to grant itself tenant-wide Power
 * Platform administration would be a privilege-escalation path.
 *
 * So this is a second, separate leg: a delegated authorization-code sign-in by a
 * Power Platform / Global Administrator. It exists as its own endpoint rather than
 * being bolted onto /api/auth/microsoft/callback so it can be re-run on its own —
 * which is exactly what is needed when a customer adds a new environment months
 * after onboarding.
 *
 *   1. GET /api/auth/microsoft/provision/start?key_id=<oauth key>
 *   2. admin signs in and consents to the delegated scopes
 *   3. GET /api/auth/microsoft/provision/callback  ← ?code=…&state=…
 *        a. register the app as a Power Platform management application
 *        b. list every environment in the tenant
 *        c. create an application user + assign a role in each one
 *   4. redirect back to the dashboard with a per-environment summary
 *
 * The refresh token is kept (encrypted) so step 3 can be replayed later without
 * another sign-in: one delegated token is needed per Dataverse org URL, and a
 * refresh token is the only way to mint tokens for resources that were not known
 * at authorize time.
 */
import { Router } from "express";
import crypto from "node:crypto";
import { getDb } from "../db.js";
import { encrypt, decrypt } from "../crypto.js";
import { PowerPlatformClient } from "../services/powerPlatformClient.js";
import { registerManagementApp, ensureApplicationUser, type EnvProvisionResult } from "../services/dataverseProvision.js";

const router = Router();

const MS_CLIENT_ID = process.env.MS_CLIENT_ID || "";
const MS_CLIENT_SECRET = process.env.MS_CLIENT_SECRET || "";
const MS_REDIRECT_URI = process.env.MS_REDIRECT_URI || "";
const UI_RETURN_URL = process.env.UI_RETURN_URL || "http://localhost:3000/CloudFuze/AIHub/AgentGovernance";

/**
 * Derived from MS_REDIRECT_URI rather than being its own required variable, so an
 * existing deployment keeps working after an upgrade. Entra matches redirect URIs
 * literally, so this exact string must also be registered on the app.
 */
const PROVISION_REDIRECT_URI =
  process.env.MS_PROVISION_REDIRECT_URI ||
  MS_REDIRECT_URI.replace(/\/callback$/, "/provision/callback");

/** Resource whose delegated scope authorises the BAP admin calls. */
const POWERAPPS_RESOURCE = "https://service.powerapps.com";

export function msProvisionConfigured(): boolean {
  return Boolean(MS_CLIENT_ID && MS_CLIENT_SECRET && PROVISION_REDIRECT_URI);
}

// ── Signed state (same reasoning as msOAuth: no storage, no cleanup) ──
const STATE_TTL_MS = 10 * 60 * 1000;
/**
 * `chained` records that we arrived here automatically from the admin-consent
 * callback rather than from an explicit button press. It changes only the wording
 * of the banner on the way out: in the chained case the admin believes they
 * performed ONE action, so a provisioning failure must not read as though the
 * Microsoft connection itself failed.
 */
function signState(keyId: string, tenant: string, chained: boolean): string {
  const payload = JSON.stringify({
    k: keyId, tn: tenant, c: chained ? 1 : 0,
    n: crypto.randomBytes(9).toString("hex"), t: Date.now(),
  });
  const b = Buffer.from(payload).toString("base64url");
  const sig = crypto.createHmac("sha256", process.env.JWT_SECRET || "dev").update(b).digest("base64url");
  return `${b}.${sig}`;
}
function verifyState(state: string): { keyId: string; tenant: string; chained: boolean } | null {
  const [b, sig] = String(state || "").split(".");
  if (!b || !sig) return null;
  const expected = crypto.createHmac("sha256", process.env.JWT_SECRET || "dev").update(b).digest("base64url");
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const { k, tn, c, t } = JSON.parse(Buffer.from(b, "base64url").toString());
    if (typeof t !== "number" || Date.now() - t >= STATE_TTL_MS) return null;
    if (typeof k !== "string" || !k) return null;
    return { keyId: k, tenant: typeof tn === "string" ? tn : "", chained: c === 1 };
  } catch { return null; }
}

/** Exchange an authorization code or refresh token for an access token. */
async function tokenRequest(tenant: string, params: Record<string, string>): Promise<{
  access_token?: string; refresh_token?: string; error?: string; error_description?: string;
}> {
  const res = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: MS_CLIENT_ID,
      client_secret: MS_CLIENT_SECRET,
      ...params,
    }).toString(),
  });
  return await res.json() as any;
}

/** Step 1 — send the admin to Microsoft to sign in and consent. */
router.get("/start", async (req, res) => {
  if (!msProvisionConfigured()) {
    res.status(503).json({
      error: "Microsoft sign-in is not configured on this server.",
      remedy: "Set MS_CLIENT_ID, MS_CLIENT_SECRET and MS_REDIRECT_URI.",
    });
    return;
  }
  const keyId = String(req.query.key_id || "");
  if (!keyId) {
    res.status(400).json({ error: "key_id is required — provisioning applies to an existing Microsoft connection." });
    return;
  }
  const db = getDb();
  const key = await db.collection("oauth_keys").findOne({ id: keyId, vendor: "microsoft" });
  if (!key) {
    res.status(404).json({ error: "Microsoft connection not found. Connect Microsoft first." });
    return;
  }

  // The tenant is pinned to the one that already consented. /organizations would
  // let an admin from a DIFFERENT tenant sign in here and have their environments
  // provisioned against this connection's row.
  const tenant = key.tenant_id || "organizations";

  const url = new URL(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`);
  url.searchParams.set("client_id", MS_CLIENT_ID);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", PROVISION_REDIRECT_URI);
  url.searchParams.set("response_mode", "query");
  // offline_access is what yields the refresh token; without it a token can only
  // ever be minted for this one resource, and each Dataverse org needs its own.
  url.searchParams.set("scope", `offline_access ${POWERAPPS_RESOURCE}/.default`);
  // No `prompt=consent` by default.
  //
  // /adminconsent already granted this app's DELEGATED permissions tenant-wide,
  // not just its application permissions — it writes an oauth2PermissionGrant with
  // consentType AllPrincipals. So when this runs immediately after that callback,
  // the admin's browser session is still live and consent is already on record:
  // Entra issues the code without showing anything. Forcing the consent screen
  // here is what made this look like a second sign-in when it does not need to be.
  //
  // If consent genuinely is missing, Entra returns interaction_required or
  // consent_required to the callback, which surfaces as `needs_consent` and the UI
  // offers a button that comes back through here with force_consent=1.
  if (String(req.query.force_consent || "") === "1") {
    url.searchParams.set("prompt", "consent");
  }
  url.searchParams.set("state", signState(keyId, key.tenant_id || "", String(req.query.chained || "") === "1"));
  res.redirect(url.toString());
});

/** Step 3 — the admin is back; do the provisioning. */
router.get("/callback", async (req, res) => {
  const back = (params: Record<string, string>) =>
    res.redirect(`${UI_RETURN_URL}?${new URLSearchParams(params).toString()}`);

  const { code, state, error, error_description } = req.query as Record<string, string>;

  const verified = verifyState(state);
  if (!verified) {
    back({ ms_provision: "error", reason: "Invalid or expired request. Please try again." });
    return;
  }
  // When chained off the connect flow, the Microsoft connection itself already
  // succeeded and is stored. Every exit below carries that fact, so a provisioning
  // problem never presents as a failed connection.
  const connected = verified.chained
    ? { ms_connect: "success", ...(verified.tenant ? { tenant: verified.tenant } : {}) }
    : {};

  if (error) {
    // Consent really is missing (first run on a tenant whose admin consent did not
    // cover these delegated scopes, or a policy requiring explicit interaction).
    // Not an error to report — an action to offer.
    const needsInteraction = error === "interaction_required" || error === "consent_required" || error === "login_required";
    back({
      ...connected,
      ms_provision: needsInteraction ? "needs_consent" : "error",
      reason: needsInteraction
        ? "Power Platform access needs one extra approval — use Grant Power Platform access."
        : (error_description || error),
    });
    return;
  }
  if (!code) {
    back({ ...connected, ms_provision: "error", reason: "Sign-in did not complete." });
    return;
  }

  try {
    const db = getDb();
    const key = await db.collection("oauth_keys").findOne({ id: verified.keyId, vendor: "microsoft" });
    if (!key) {
      back({ ...connected, ms_provision: "error", reason: "Microsoft connection no longer exists." });
      return;
    }
    const tenant = key.tenant_id || "organizations";

    const tokens = await tokenRequest(tenant, {
      grant_type: "authorization_code",
      code,
      redirect_uri: PROVISION_REDIRECT_URI,
    });
    if (!tokens.access_token || !tokens.refresh_token) {
      // No refresh token despite a code usually means offline_access was not
      // consented, which the extra approval fixes — same remedy as consent_required.
      const consentish = tokens.error === "invalid_grant" || (tokens.access_token && !tokens.refresh_token);
      back({
        ...connected,
        ms_provision: consentish ? "needs_consent" : "error",
        reason: consentish
          ? "Power Platform access needs one extra approval — use Grant Power Platform access."
          : (tokens.error_description || tokens.error || "Could not complete sign-in."),
      });
      return;
    }

    // ── (a) management application ──
    const mgmt = await registerManagementApp(tokens.access_token, MS_CLIENT_ID);

    // ── (b) enumerate environments with the DELEGATED token ──
    // Deliberately the delegated token, not the app-only one: on a tenant that was
    // never provisioned the app-only call is exactly what returns nothing, which is
    // the situation this endpoint exists to fix.
    let envUrls: string[] = [];
    try {
      const envs = await new PowerPlatformClient(tokens.access_token).listEnvironments();
      envUrls = envs
        .map(e => e.properties?.linkedEnvironmentMetadata?.instanceUrl)
        .filter((u): u is string => Boolean(u))
        .map(u => u.replace(/\/$/, ""));
    } catch (e) {
      console.warn("[Provision] Could not list environments:", e instanceof Error ? e.message : e);
    }

    // ── (c) one application user per environment ──
    const results: EnvProvisionResult[] = [];
    for (const url of envUrls) {
      // A separate delegated token per org URL — a Dataverse token's scope IS the
      // org, so one cannot be reused across environments.
      const dvTok = await tokenRequest(tenant, {
        grant_type: "refresh_token",
        refresh_token: tokens.refresh_token,
        scope: `${url}/.default`,
      });
      if (!dvTok.access_token) {
        results.push({
          url,
          status: "failed",
          detail: dvTok.error_description || dvTok.error || "Could not obtain a Dataverse token.",
        });
        continue;
      }
      results.push(await ensureApplicationUser(url, dvTok.access_token, MS_CLIENT_ID));
    }

    await db.collection("oauth_keys").updateOne(
      { id: verified.keyId },
      {
        $set: {
          // Kept so provisioning can be replayed for a newly added environment
          // without dragging the admin through another sign-in.
          pp_admin_refresh_token: encrypt(tokens.refresh_token),
          management_app_registered: mgmt.ok,
          provisioned_at: new Date(),
          provision_results: results,
          updated_at: new Date(),
        },
      },
    );

    const ok = results.filter(r => r.status !== "failed").length;
    console.log(`[Provision] ${ok}/${results.length} environment(s) ready; management app ok=${mgmt.ok}`);
    back({
      ...connected,
      ms_provision: mgmt.ok && ok === results.length && results.length > 0 ? "success" : "partial",
      environments: String(results.length),
      ready: String(ok),
      ...(mgmt.ok ? {} : { reason: mgmt.detail || "Management app registration failed." }),
    });
  } catch (err) {
    console.error("[Provision] callback failed:", err instanceof Error ? err.message : err);
    back({ ...connected, ms_provision: "error", reason: "Provisioning could not be completed." });
  }
});

/**
 * What state is this connection in? Drives the UI so an operator can see which
 * environments are ready without re-running anything.
 */
router.get("/status", async (req, res) => {
  const keyId = String(req.query.key_id || "");
  if (!keyId) {
    res.status(400).json({ error: "key_id is required" });
    return;
  }
  const db = getDb();
  const key = await db.collection("oauth_keys").findOne({ id: keyId, vendor: "microsoft" });
  if (!key) {
    res.status(404).json({ error: "Microsoft connection not found" });
    return;
  }
  res.json({
    configured: msProvisionConfigured(),
    redirect_uri: PROVISION_REDIRECT_URI,
    role: process.env.MS_DATAVERSE_APP_ROLE || "System Administrator",
    management_app_registered: Boolean(key.management_app_registered),
    provisioned_at: key.provisioned_at || null,
    // Never the token itself — only whether a replay is possible.
    can_replay: Boolean(key.pp_admin_refresh_token),
    environments: key.provision_results || [],
  });
});

/**
 * Re-run provisioning using the stored refresh token — for the "customer added a
 * new environment" case, which is the whole reason the token is kept.
 */
router.post("/replay", async (req, res) => {
  const keyId = String(req.query.key_id || req.body?.key_id || "");
  if (!keyId) {
    res.status(400).json({ error: "key_id is required" });
    return;
  }
  const db = getDb();
  const key = await db.collection("oauth_keys").findOne({ id: keyId, vendor: "microsoft" });
  if (!key?.pp_admin_refresh_token) {
    res.status(409).json({
      error: "No stored administrator grant for this connection.",
      remedy: "Run the Grant Power Platform access flow once first.",
    });
    return;
  }
  const tenant = key.tenant_id || "organizations";

  try {
    const refreshed = await tokenRequest(tenant, {
      grant_type: "refresh_token",
      refresh_token: decrypt(key.pp_admin_refresh_token),
      scope: `${POWERAPPS_RESOURCE}/.default`,
    });
    if (!refreshed.access_token) {
      // invalid_grant here means the admin revoked consent, left, or had sessions
      // reset — say that rather than "refresh failed".
      res.status(401).json({
        error:
          refreshed.error === "invalid_grant"
            ? "The administrator grant is no longer valid — they may have revoked access or left the organisation. Run the flow again."
            : refreshed.error_description || "Could not refresh the administrator grant.",
      });
      return;
    }

    const mgmt = await registerManagementApp(refreshed.access_token, MS_CLIENT_ID);

    let envUrls: string[] = [];
    try {
      const envs = await new PowerPlatformClient(refreshed.access_token).listEnvironments();
      envUrls = envs
        .map(e => e.properties?.linkedEnvironmentMetadata?.instanceUrl)
        .filter((u): u is string => Boolean(u))
        .map(u => u.replace(/\/$/, ""));
    } catch (e) {
      console.warn("[Provision] replay could not list environments:", e instanceof Error ? e.message : e);
    }

    const results: EnvProvisionResult[] = [];
    for (const url of envUrls) {
      const dvTok = await tokenRequest(tenant, {
        grant_type: "refresh_token",
        // The newly returned refresh token when present: Entra rotates them, and
        // reusing a superseded one eventually fails.
        refresh_token: refreshed.refresh_token || decrypt(key.pp_admin_refresh_token),
        scope: `${url}/.default`,
      });
      if (!dvTok.access_token) {
        results.push({ url, status: "failed", detail: dvTok.error_description || dvTok.error || "No Dataverse token." });
        continue;
      }
      results.push(await ensureApplicationUser(url, dvTok.access_token, MS_CLIENT_ID));
    }

    await db.collection("oauth_keys").updateOne(
      { id: keyId },
      {
        $set: {
          ...(refreshed.refresh_token ? { pp_admin_refresh_token: encrypt(refreshed.refresh_token) } : {}),
          management_app_registered: mgmt.ok,
          provisioned_at: new Date(),
          provision_results: results,
          updated_at: new Date(),
        },
      },
    );

    res.json({
      management_app_registered: mgmt.ok,
      management_app_detail: mgmt.detail,
      environments: results,
      ready: results.filter(r => r.status !== "failed").length,
      total: results.length,
    });
  } catch (e) {
    console.error("[Provision] replay failed:", e instanceof Error ? e.message : e);
    res.status(500).json({ error: "Provisioning replay failed." });
  }
});

export default router;
