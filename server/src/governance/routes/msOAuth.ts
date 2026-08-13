/**
 * Microsoft interactive admin-consent flow.
 *
 * Replaces "register your own Entra app, then paste client ID + secret + tenant"
 * with "click Connect, sign in, approve". The admin never sees a client ID
 * because the app is OURS, registered once by CloudFuze as multi-tenant; the
 * customer only grants it consent for their tenant.
 *
 *   1. GET  /api/auth/microsoft/start     → redirects to Microsoft's consent page
 *   2. admin signs in and approves for the whole tenant
 *   3. GET  /api/auth/microsoft/callback  ← ?admin_consent=True&tenant=<guid>&state=<nonce>
 *   4. store the tenant, redirect back into the dashboard
 *
 * After that, tokens are minted exactly as before — `client_credentials` against
 * THEIR tenant using OUR client_id/secret. Only the source of the credentials
 * changes, so every downstream scan is unaffected.
 *
 * This is admin consent, NOT a user sign-in: the resulting access is app-only and
 * tenant-wide, so it keeps working after the admin who granted it leaves. A
 * delegated user token would die with their account, which is wrong for
 * continuous governance scanning.
 */
import { Router } from "express";
import crypto from "node:crypto";
import { getDb } from "../db.js";
import { v4 as uuidv4 } from "uuid";
import { msProvisionConfigured } from "./msProvision.js";

const router = Router();

/** Our multi-tenant app. Absent until CloudFuze registers it — see isConfigured(). */
const MS_CLIENT_ID = process.env.MS_CLIENT_ID || "";
const MS_CLIENT_SECRET = process.env.MS_CLIENT_SECRET || "";
const MS_REDIRECT_URI = process.env.MS_REDIRECT_URI || "";
/** Where to send the browser once consent completes. */
const UI_RETURN_URL = process.env.UI_RETURN_URL || "http://localhost:3000/CloudFuze/AIHub/AgentGovernance";

export function msOAuthConfigured(): boolean {
  return Boolean(MS_CLIENT_ID && MS_CLIENT_SECRET && MS_REDIRECT_URI);
}

/**
 * Short-lived signed state, to stop a third party from replaying a callback and
 * attaching THEIR tenant to this deployment. Signed with JWT_SECRET rather than
 * stored, so it needs no cleanup and cannot leak across restarts.
 */
const STATE_TTL_MS = 10 * 60 * 1000;
function signState(): string {
  const payload = JSON.stringify({ n: crypto.randomBytes(12).toString("hex"), t: Date.now() });
  const b = Buffer.from(payload).toString("base64url");
  const sig = crypto.createHmac("sha256", process.env.JWT_SECRET || "dev").update(b).digest("base64url");
  return `${b}.${sig}`;
}
function verifyState(state: string): boolean {
  const [b, sig] = String(state || "").split(".");
  if (!b || !sig) return false;
  const expected = crypto.createHmac("sha256", process.env.JWT_SECRET || "dev").update(b).digest("base64url");
  // timingSafeEqual throws on length mismatch, so guard first.
  if (sig.length !== expected.length) return false;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
  try {
    const { t } = JSON.parse(Buffer.from(b, "base64url").toString());
    return typeof t === "number" && Date.now() - t < STATE_TTL_MS;
  } catch { return false; }
}

/** Is the interactive flow available on this deployment? Drives the UI. */
router.get("/status", (_req, res) => {
  res.json({
    configured: msOAuthConfigured(),
    // Named so an operator can see exactly what is missing without exposing values.
    missing: [
      !MS_CLIENT_ID && "MS_CLIENT_ID",
      !MS_CLIENT_SECRET && "MS_CLIENT_SECRET",
      !MS_REDIRECT_URI && "MS_REDIRECT_URI",
    ].filter(Boolean),
  });
});

/** Step 1 — send the admin to Microsoft's tenant-wide consent page. */
router.get("/start", (_req, res) => {
  if (!msOAuthConfigured()) {
    res.status(503).json({
      error: "Microsoft sign-in is not configured on this server.",
      remedy: "Register the CloudFuze multi-tenant app in Entra and set MS_CLIENT_ID, MS_CLIENT_SECRET and MS_REDIRECT_URI.",
    });
    return;
  }
  // `/organizations` not `/common`: this is a work-account flow. /common also
  // admits personal Microsoft accounts, which have no tenant to govern.
  const url = new URL("https://login.microsoftonline.com/organizations/v2.0/adminconsent");
  url.searchParams.set("client_id", MS_CLIENT_ID);
  // .default requests every application permission already declared on the app
  // registration, so the permission set is controlled in Entra rather than here.
  url.searchParams.set("scope", "https://graph.microsoft.com/.default");
  url.searchParams.set("redirect_uri", MS_REDIRECT_URI);
  url.searchParams.set("state", signState());
  res.redirect(url.toString());
});

/** Step 3 — Microsoft returns here after the admin approves (or declines). */
router.get("/callback", async (req, res) => {
  const back = (params: Record<string, string>) =>
    res.redirect(`${UI_RETURN_URL}?${new URLSearchParams(params).toString()}`);

  try {
    const { admin_consent, tenant, state, error, error_description } = req.query as Record<string, string>;

    if (!verifyState(state)) {
      // Do not touch storage on an unverified callback.
      back({ ms_connect: "error", reason: "Invalid or expired sign-in request. Please try again." });
      return;
    }
    if (error) {
      back({ ms_connect: "error", reason: error_description || error });
      return;
    }
    if (admin_consent !== "True" || !tenant) {
      back({ ms_connect: "error", reason: "Consent was not granted." });
      return;
    }

    const db = getDb();
    const now = new Date();

    // Upsert on tenant so re-consenting updates rather than creating duplicates.
    //
    // The platform CLIENT SECRET is deliberately NOT copied into the row.
    // Storing it per customer looked harmless but meant that rotating
    // MS_CLIENT_SECRET in the server env would leave every existing customer row
    // holding the OLD secret — and each one would start failing auth silently,
    // one stale copy per tenant. `auth_method: "admin_consent"` tells
    // tokenManager to read the current secret from the environment instead, so
    // rotation is a single change in one place.
    //
    // client_id IS stored: it is not a secret, it identifies which app was
    // consented to, and it keeps the row self-describing if the platform app is
    // ever replaced.
    const existing = await db.collection("oauth_keys").findOne({ vendor: "microsoft", tenant_id: tenant });
    const id = existing?.id || uuidv4();
    await db.collection("oauth_keys").updateOne(
      { vendor: "microsoft", tenant_id: tenant },
      {
        $set: {
          vendor: "microsoft",
          tenant_id: tenant,          // THE customer's tenant — this is what makes rows distinct
          client_id: MS_CLIENT_ID,    // our app, identical across every customer
          auth_method: "admin_consent",
          updated_at: now,
        },
        $setOnInsert: { id, created_at: now },
      },
      { upsert: true },
    );

    // Continue straight into Power Platform provisioning instead of returning to
    // the dashboard here.
    //
    // Admin consent covers Graph, but Copilot Studio also needs the app registered
    // as a Power Platform management application and an Application User in each
    // Dataverse environment — neither of which an app-only token may do. Those need
    // a delegated token, and the moment to collect one is NOW: the admin is signed
    // in, in this browser, and /adminconsent has just granted this app's delegated
    // permissions tenant-wide as well (an AllPrincipals oauth2PermissionGrant), so
    // the authorize call below normally completes without showing them anything.
    //
    // Sending them back to the dashboard first is what turned this into two
    // separate sign-ins. chained=1 tells the provisioning callback to report the
    // connection as successful regardless of how provisioning goes, so one action
    // reads as one outcome.
    if (msProvisionConfigured()) {
      res.redirect(`/api/auth/microsoft/provision/start?key_id=${encodeURIComponent(id)}&chained=1`);
      return;
    }
    back({ ms_connect: "success", tenant, key_id: id });
  } catch (err) {
    console.error("[msOAuth] callback failed:", err instanceof Error ? err.message : err);
    back({ ms_connect: "error", reason: "Could not complete the connection." });
  }
});

export default router;
