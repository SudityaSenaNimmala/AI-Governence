/**
 * Google interactive admin sign-in.
 *
 * The Google counterpart to msOAuth.ts: the admin clicks Connect, signs in with
 * their own Workspace account, approves, and we store a refresh token. No
 * service-account JSON to download, no domain-wide delegation to configure in
 * the Admin console, no project ID to look up.
 *
 *   1. GET /api/auth/google/start     → accounts.google.com consent screen
 *   2. admin signs in and approves
 *   3. GET /api/auth/google/callback  ← ?code=...&state=...
 *   4. exchange the code for a refresh token, store it encrypted
 *
 * IMPORTANT DIFFERENCE FROM MICROSOFT — read before relying on this.
 *
 * Microsoft's admin consent grants APP-ONLY, tenant-wide access: it survives the
 * admin who granted it leaving the company. Google's authorization-code flow
 * issues a refresh token that acts AS the consenting user. So:
 *
 *   • the token inherits that admin's privileges — they must be a Workspace
 *     super-admin for Admin SDK reads to work;
 *   • if that account is suspended, deleted, or has its password reset with
 *     "revoke sessions", the connection dies and must be re-consented;
 *   • Google may also expire a refresh token if unused for six months.
 *
 * The service-account + domain-wide-delegation path stays available and remains
 * the better choice for unattended, long-lived scanning. This flow is for fast
 * onboarding, not for replacing it.
 */
import { Router } from "express";
import crypto from "node:crypto";
import { getDb } from "../db.js";
import { encrypt, decrypt } from "../crypto.js";
import { v4 as uuidv4 } from "uuid";

const router = Router();

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || "";
const UI_RETURN_URL = process.env.UI_RETURN_URL || "http://localhost:3000/CloudFuze/AIHub/AgentGovernance";

/**
 * Exactly what the scans below need, and nothing more — the consent screen lists
 * every one of these to the admin, so an unnecessary scope is both a slower
 * approval and a harder security review.
 *
 * admin.directory.* and chat.* are SENSITIVE/RESTRICTED scopes: until the OAuth
 * consent screen is verified by Google, users see an "unverified app" warning and
 * the app is capped at 100 users. Verification is a review process measured in
 * weeks, so plan for it rather than discovering it at launch.
 */
const SCOPES = [
  // ── Google Chat bots (discoverChatBots) ──────────────────────────────────
  // The chat.admin.* pair is what makes this a TENANT-WIDE listing rather than
  // just the signing admin's own spaces. Without them Chat discovery quietly
  // shrinks to whatever the one admin happens to be a member of.
  "https://www.googleapis.com/auth/chat.admin.spaces.readonly",
  "https://www.googleapis.com/auth/chat.admin.memberships.readonly",
  "https://www.googleapis.com/auth/chat.spaces.readonly",
  "https://www.googleapis.com/auth/chat.memberships.readonly",

  // ── Gemini Gems (discoverGems) ───────────────────────────────────────────
  // Gems are found via the Reports audit log, then resolved through Drive.
  "https://www.googleapis.com/auth/admin.reports.audit.readonly",
  "https://www.googleapis.com/auth/drive.readonly",

  // ── Vertex AI, Agent Builder, NotebookLM ─────────────────────────────────
  // cloud-platform (full) is what those calls request today; read-only alone
  // makes them 403. cloud-platform.read-only is additionally required by
  // listAccessibleProjects, which enumerates the projects to scan.
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/cloud-platform.read-only",

  // Identifies WHO consented, so the row records whose departure breaks it.
  "openid", "email",
];

/**
 * Scopes the discovery code actually calls getToken() with.
 *
 * Kept next to SCOPES on purpose: with the service-account path gone, a scope
 * the client requests but the consent screen never asked for is a silent 403 —
 * one whole discovery source (Chat bots, Gems, Vertex) returns nothing and the
 * scan still reports success. That is the exact failure mode this endpoint
 * exists to avoid, so the mismatch is asserted at boot instead of discovered in
 * production.
 *
 * If a new scan needs a new scope, add it here AND to SCOPES, then re-consent —
 * an existing refresh token does not gain scopes retroactively.
 */
const REQUIRED_BY_DISCOVERY = [
  "https://www.googleapis.com/auth/chat.admin.spaces.readonly",
  "https://www.googleapis.com/auth/chat.admin.memberships.readonly",
  "https://www.googleapis.com/auth/chat.spaces.readonly",
  "https://www.googleapis.com/auth/chat.memberships.readonly",
  "https://www.googleapis.com/auth/admin.reports.audit.readonly",
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/cloud-platform.read-only",
];
{
  const missing = REQUIRED_BY_DISCOVERY.filter((s) => !SCOPES.includes(s));
  if (missing.length) {
    // Loud at startup rather than a 403 buried in one scan's warnings.
    console.error(`[googleOAuth] SCOPES is missing scopes the discovery code uses: ${missing.join(", ")}`);
  }
}

export function googleOAuthConfigured(): boolean {
  return Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && GOOGLE_REDIRECT_URI);
}

// Same signed, short-lived state as the Microsoft flow: without it a third party
// could replay a callback and attach their own account to this deployment.
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
  if (sig.length !== expected.length) return false;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
  try {
    const { t } = JSON.parse(Buffer.from(b, "base64url").toString());
    return typeof t === "number" && Date.now() - t < STATE_TTL_MS;
  } catch { return false; }
}

router.get("/status", (_req, res) => {
  res.json({
    configured: googleOAuthConfigured(),
    missing: [
      !GOOGLE_CLIENT_ID && "GOOGLE_CLIENT_ID",
      !GOOGLE_CLIENT_SECRET && "GOOGLE_CLIENT_SECRET",
      !GOOGLE_REDIRECT_URI && "GOOGLE_REDIRECT_URI",
    ].filter(Boolean),
  });
});

router.get("/start", (_req, res) => {
  if (!googleOAuthConfigured()) {
    res.status(503).json({
      error: "Google sign-in is not configured on this server.",
      remedy: "Create an OAuth client in Google Cloud and set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REDIRECT_URI.",
    });
    return;
  }
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", GOOGLE_CLIENT_ID);
  url.searchParams.set("redirect_uri", GOOGLE_REDIRECT_URI);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SCOPES.join(" "));
  // access_type=offline is what yields a refresh token at all; prompt=consent
  // forces Google to RE-issue one. Without prompt, a returning admin who already
  // approved gets an access token and no refresh token, and the connection dies
  // in an hour — a genuinely confusing failure to debug later.
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("state", signState());
  res.redirect(url.toString());
});

router.get("/callback", async (req, res) => {
  const back = (params: Record<string, string>) =>
    res.redirect(`${UI_RETURN_URL}?${new URLSearchParams(params).toString()}`);

  try {
    const { code, state, error } = req.query as Record<string, string>;

    if (!verifyState(state)) {
      back({ google_connect: "error", reason: "Invalid or expired sign-in request. Please try again." });
      return;
    }
    if (error) { back({ google_connect: "error", reason: error }); return; }
    if (!code)  { back({ google_connect: "error", reason: "Consent was not granted." }); return; }

    // Exchange the one-time code for tokens.
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: GOOGLE_REDIRECT_URI,
        grant_type: "authorization_code",
      }).toString(),
    });
    const tok = await tokenRes.json() as { refresh_token?: string; access_token?: string; id_token?: string; error_description?: string; error?: string };
    if (!tokenRes.ok) {
      back({ google_connect: "error", reason: tok.error_description || tok.error || "Token exchange failed." });
      return;
    }
    if (!tok.refresh_token) {
      // Happens when the account has consented before and prompt=consent was not
      // honoured. Without a refresh token the connection would silently stop
      // working in about an hour, so refuse it rather than store something broken.
      back({
        google_connect: "error",
        reason: "Google did not return a refresh token. Remove this app at myaccount.google.com/permissions and try again.",
      });
      return;
    }

    // Who consented, and for which domain — read from the id_token rather than
    // asking. The token acts as this person, so recording them is not cosmetic:
    // it is how you know whose departure will break the connection.
    let email: string | null = null;
    let domain: string | null = null;
    try {
      const claims = JSON.parse(Buffer.from(String(tok.id_token).split(".")[1], "base64url").toString());
      email = claims.email || null;
      domain = claims.hd || (email ? String(email).split("@")[1] : null);
    } catch { /* id_token is informational; absence must not fail the connect */ }

    const db = getDb();
    const now = new Date();
    // Keyed on domain so re-consenting the same Workspace updates in place.
    const existing = await db.collection("oauth_keys").findOne({ vendor: "google", tenant_id: domain });
    const id = existing?.id || uuidv4();
    await db.collection("oauth_keys").updateOne(
      { vendor: "google", tenant_id: domain },
      {
        $set: {
          vendor: "google",
          tenant_id: domain,
          client_id: GOOGLE_CLIENT_ID,
          // The REFRESH token is the credential here, and it is per-customer, so
          // unlike the Microsoft platform secret it does belong on the row.
          google_refresh_token: encrypt(tok.refresh_token),
          google_admin_email: email,
          auth_method: "oauth",
          updated_at: now,
        },
        $setOnInsert: { id, created_at: now },
      },
      { upsert: true },
    );

    back({ google_connect: "success", domain: domain || "", email: email || "", key_id: id });
  } catch (err) {
    console.error("[googleOAuth] callback failed:", err instanceof Error ? err.message : err);
    back({ google_connect: "error", reason: "Could not complete the connection." });
  }
});

/**
 * Mint a short-lived access token from a stored refresh token.
 *
 * Used by discovery in place of the service-account JWT exchange when a
 * connection was made through this flow. Not cached here — the Google client
 * holds it for the life of one scan, and refresh exchanges are cheap relative to
 * a full discovery run.
 */
export async function accessTokenFromRefresh(refreshTokenEncrypted: string): Promise<string> {
  if (!googleOAuthConfigured()) throw new Error("Google OAuth is not configured on this server.");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: decrypt(refreshTokenEncrypted),
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      grant_type: "refresh_token",
    }).toString(),
  });
  const body = await res.json() as { access_token?: string; error_description?: string; error?: string };
  if (!res.ok || !body.access_token) {
    // invalid_grant here almost always means the admin revoked access, changed
    // password with session revocation, or the account was suspended. Say so —
    // "token refresh failed" sends people looking in the wrong place.
    const detail = body.error === "invalid_grant"
      ? "the Google account that granted access has revoked it, been suspended, or had its sessions reset — reconnect to restore access"
      : (body.error_description || body.error || "unknown error");
    throw new Error(`Google token refresh failed: ${detail}`);
  }
  return body.access_token;
}

export default router;
