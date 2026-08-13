/**
 * Automated Power Platform / Dataverse provisioning.
 *
 * Admin consent alone is not enough to inventory Copilot Studio agents. A tenant
 * needs three separate grants, and only the first is covered by the consent flow:
 *
 *   1. Graph application permissions          — admin consent  (already automated)
 *   2. App registered as a Power Platform     — this file      (once per tenant)
 *      management application
 *   3. An Application User in EACH Dataverse  — this file      (once per environment)
 *      environment
 *
 * Steps 2 and 3 cannot be done with the app-only token the rest of the scan uses.
 * Microsoft gates them behind an admin USER identity on purpose — an application
 * that could grant itself tenant-wide Power Platform administration would be a
 * privilege-escalation path. So these functions take a DELEGATED token obtained
 * from an interactive Power Platform / Global Administrator sign-in.
 *
 * Without step 2, listEnvironments() returns nothing and discovery reports "no
 * Dataverse environment could be discovered". Without step 3 for a given
 * environment, Dataverse answers 0x80072560 "The user is not a member of the
 * organization" — a token is issued for any org URL, but each org decides
 * separately whether to honour it.
 */

const BAP_BASE = "https://api.bap.microsoft.com";
const BAP_API_VERSION = "2020-10-01";

/**
 * Security role granted to the application user.
 *
 * Defaults to System Administrator, which is more than a read-only scanner needs.
 * There is no built-in role that covers exactly `bots`, `botcomponents` and
 * `conversationtranscript`, and creating a custom least-privilege role
 * programmatically in every customer environment is a much larger job than this.
 * Overridable so a customer who has built such a role can name it, and the role
 * actually assigned is always logged and returned.
 */
const APP_USER_ROLE = process.env.MS_DATAVERSE_APP_ROLE || "System Administrator";

export type EnvProvisionResult = {
  url: string;
  status: "created" | "already_present" | "role_added" | "failed";
  role?: string;
  detail?: string;
};

async function bapFetch(token: string, path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${BAP_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
}

/**
 * Step 2 — register our app as a Power Platform management application.
 *
 * Equivalent to `New-PowerAppManagementApp -ApplicationId <appId>`. Idempotent:
 * the list is checked first so a re-run reports already_registered instead of
 * writing again.
 */
export async function registerManagementApp(
  delegatedPowerAppsToken: string,
  appId: string,
): Promise<{ ok: boolean; alreadyRegistered: boolean; detail?: string }> {
  const listPath = `/providers/Microsoft.BusinessAppPlatform/adminApplications?api-version=${BAP_API_VERSION}`;
  try {
    const listRes = await bapFetch(delegatedPowerAppsToken, listPath);
    if (listRes.ok) {
      const body = await listRes.json() as { value?: Array<{ applicationId?: string }> };
      const present = (body.value || []).some(
        a => (a.applicationId || "").toLowerCase() === appId.toLowerCase(),
      );
      if (present) {
        console.log("[Provision] App is already a Power Platform management application");
        return { ok: true, alreadyRegistered: true };
      }
    }
  } catch (e) {
    // A failed pre-check is not fatal — fall through and attempt the write.
    console.warn("[Provision] Could not list management apps:", e instanceof Error ? e.message : e);
  }

  const putPath = `/providers/Microsoft.BusinessAppPlatform/adminApplications/${appId}?api-version=${BAP_API_VERSION}`;
  const res = await bapFetch(delegatedPowerAppsToken, putPath, { method: "PUT", body: "{}" });
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 500);
    console.error(`[Provision] Management app registration failed (${res.status}): ${detail}`);
    return {
      ok: false,
      alreadyRegistered: false,
      detail:
        res.status === 403
          ? "The signed-in account is not a Power Platform or Global Administrator, so it cannot register a management application."
          : `HTTP ${res.status}: ${detail}`,
    };
  }
  console.log("[Provision] Registered app as a Power Platform management application");
  return { ok: true, alreadyRegistered: false };
}

async function dvFetch(orgUrl: string, token: string, path: string, init?: RequestInit): Promise<Response> {
  const base = orgUrl.replace(/\/$/, "");
  return fetch(`${base}/api/data/v9.2${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      "OData-MaxVersion": "4.0",
      "OData-Version": "4.0",
      ...(init?.headers || {}),
    },
  });
}

async function dvJson<T>(orgUrl: string, token: string, path: string): Promise<T> {
  const res = await dvFetch(orgUrl, token, path);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return await res.json() as T;
}

/**
 * Step 3 — make our app an Application User in one Dataverse environment.
 *
 * Idempotent in both halves: an existing application user is reused rather than
 * duplicated, and the role is only added when it is not already assigned. This
 * matters because the same environment gets re-provisioned whenever an admin
 * re-runs the flow after adding a new environment.
 */
export async function ensureApplicationUser(
  orgUrl: string,
  delegatedDataverseToken: string,
  appId: string,
): Promise<EnvProvisionResult> {
  const token = delegatedDataverseToken;
  try {
    // ── Does an application user already exist for this app? ──
    const existing = await dvJson<{ value?: Array<{ systemuserid: string }> }>(
      orgUrl, token,
      `/systemusers?$select=systemuserid&$filter=applicationid eq ${appId}`,
    );
    let systemUserId = existing.value?.[0]?.systemuserid;
    const preexisting = Boolean(systemUserId);

    if (!systemUserId) {
      // A new application user must be attached to a business unit; the root one
      // is the only choice that is guaranteed to exist in every environment.
      const bus = await dvJson<{ value?: Array<{ businessunitid: string }> }>(
        orgUrl, token,
        "/businessunits?$select=businessunitid&$filter=parentbusinessunitid eq null",
      );
      const buId = bus.value?.[0]?.businessunitid;
      if (!buId) return { url: orgUrl, status: "failed", detail: "Could not find the root business unit." };

      const createRes = await dvFetch(orgUrl, token, "/systemusers", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          applicationid: appId,
          "businessunitid@odata.bind": `/businessunits(${buId})`,
        }),
      });
      if (!createRes.ok) {
        const detail = (await createRes.text()).slice(0, 400);
        return { url: orgUrl, status: "failed", detail: `Could not create the application user — ${detail}` };
      }
      const created = await createRes.json() as { systemuserid?: string };
      systemUserId = created.systemuserid;
      if (!systemUserId) return { url: orgUrl, status: "failed", detail: "Created the user but no id was returned." };
      console.log(`[Provision] ${orgUrl}: created application user ${systemUserId}`);
    }

    // ── Ensure the security role is assigned ──
    const roles = await dvJson<{ value?: Array<{ roleid: string; name: string }> }>(
      orgUrl, token,
      `/roles?$select=roleid,name&$filter=name eq '${APP_USER_ROLE.replace(/'/g, "''")}'`,
    );
    const role = roles.value?.[0];
    if (!role) {
      return {
        url: orgUrl,
        status: preexisting ? "already_present" : "created",
        detail: `Security role "${APP_USER_ROLE}" does not exist in this environment, so no role was assigned. Scans will fail until one is.`,
      };
    }

    const assigned = await dvJson<{ value?: Array<{ roleid: string }> }>(
      orgUrl, token,
      `/systemusers(${systemUserId})/systemuserroles_association?$select=roleid`,
    );
    const hasRole = (assigned.value || []).some(r => r.roleid === role.roleid);

    if (!hasRole) {
      const base = orgUrl.replace(/\/$/, "");
      const refRes = await dvFetch(orgUrl, token, `/systemusers(${systemUserId})/systemuserroles_association/$ref`, {
        method: "POST",
        body: JSON.stringify({ "@odata.id": `${base}/api/data/v9.2/roles(${role.roleid})` }),
      });
      if (!refRes.ok) {
        const detail = (await refRes.text()).slice(0, 400);
        return { url: orgUrl, status: "failed", detail: `Application user exists but the role could not be assigned — ${detail}` };
      }
      console.log(`[Provision] ${orgUrl}: assigned role "${role.name}"`);
      return { url: orgUrl, status: preexisting ? "role_added" : "created", role: role.name };
    }

    return { url: orgUrl, status: preexisting ? "already_present" : "created", role: role.name };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // The signing-in admin may hold Power Platform Administrator at tenant level
    // and still not be a member of an individual org, which is a different
    // failure from "our app has no user" and needs saying so.
    const notMember = msg.includes("0x80072560") || msg.includes("not a member of the organization");
    return {
      url: orgUrl,
      status: "failed",
      detail: notMember
        ? "The signed-in administrator is not a member of this environment, so no application user could be created here. Add them to the environment, or create the application user manually."
        : msg,
    };
  }
}
