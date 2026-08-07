import { Router } from "express";
import { getDb } from "../db.js";
import { getValidToken } from "../services/tokenManager.js";
import { GraphClient } from "../services/graphClient.js";
import { v4 as uuidv4 } from "uuid";

const router = Router();

// ── Types ────────────────────────────────────────────────────────────────
interface Finding {
  id: string;
  category: "sharepoint" | "onedrive" | "teams" | "exchange";
  severity: "critical" | "high" | "medium" | "low";
  title: string;
  description: string;
  resource: string;
  resourceUrl?: string;
  exposedTo: string;
  remediation: string;
}

interface ScanResult {
  id: string;
  oauthKeyId: string;
  status: "running" | "completed" | "failed";
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  riskLevel: "critical" | "high" | "medium" | "low" | "none";
  summary: {
    totalFindings: number;
    critical: number;
    high: number;
    medium: number;
    low: number;
    sharepoint: number;
    onedrive: number;
    teams: number;
    exchange: number;
    highRiskFindings: number;
  };
  findings: Finding[];
  error?: string;
}

// ── Scan Logic ───────────────────────────────────────────────────────────

async function scanSharePoint(graph: GraphClient): Promise<Finding[]> {
  const findings: Finding[] = [];
  try {
    // Get SharePoint sites via Groups (M365 group-connected sites) — works with app-only auth
    // /sites?search=* requires region param for app auth, so use groups instead
    const groups = await graph.getAllPages<any>("/v1.0/groups", {
      $filter: "groupTypes/any(c:c eq 'Unified')",
      $select: "id,displayName,webUrl,siteId",
      $top: "100",
    }, 5);

    // Also get root site and its children
    const rootChildren = await graph.get<any>("/v1.0/sites/root/sites?$top=50").catch(() => ({ value: [] }));
    const rootSites = (rootChildren.value || []);

    // Check groups for public visibility — Public M365 groups mean anyone can join and
    // access the associated SharePoint site. This is equivalent to "Everyone" access.
    // Classic SP permissions (/_api/web/roleassignments) need SharePoint REST auth,
    // but group visibility is fully accessible via Graph with Directory.Read.All.
    console.log(`[copilot-readiness] sharepoint: checking ${groups.length} M365 groups for public visibility`);

    for (const g of groups) {
      // Public group = anyone in the org can join and access the SharePoint site
      if (g.visibility === "Public") {
        try {
          const site = await graph.get<any>(`/v1.0/groups/${g.id}/sites/root?$select=id,webUrl,displayName`);
          if (site?.id) {
            findings.push({
              id: uuidv4(),
              category: "sharepoint",
              severity: "high",
              title: `SharePoint site "${g.displayName}" is publicly accessible`,
              description: `The M365 group "${g.displayName}" is set to "Public" — any employee can join and access the associated SharePoint site and all its documents. When Copilot is enabled, it will surface these documents to all employees.`,
              resource: g.displayName,
              resourceUrl: site.webUrl,
              exposedTo: "All employees (public group)",
              remediation: `Go to Microsoft 365 Admin Center → Groups → ${g.displayName} → Settings → Change Privacy from "Public" to "Private". Then review SharePoint site members.`,
            });
          }
        } catch { /* no site for this group */ }
      }

      // Also check for org-wide sharing links on the site's drive
      try {
        const site = await graph.get<any>(`/v1.0/groups/${g.id}/sites/root?$select=id,webUrl,displayName`).catch(() => null);
        if (!site?.id) continue;

        const drive = await graph.get<any>(`/v1.0/sites/${site.id}/drive?$select=id`).catch(() => null);
        if (!drive?.id) continue;

        const rootItems = await graph.getAllPages<any>(
          `/v1.0/drives/${drive.id}/root/children`,
          { $select: "id,name,shared,webUrl", $top: "50" }, 2
        ).catch(() => []);

        for (const item of rootItems) {
          if (item.shared && item.shared.scope === "organization") {
            findings.push({
              id: uuidv4(),
              category: "sharepoint",
              severity: "high",
              title: `"${item.name}" in ${g.displayName} shared with entire org`,
              description: `This file/folder has an org-wide sharing link — any employee can access it via the link. Copilot will surface its contents to all employees.`,
              resource: `${g.displayName}/${item.name}`,
              resourceUrl: item.webUrl,
              exposedTo: "Entire organization",
              remediation: `Open the file → Share → Manage Access → Change "People in organization" link to "Specific people" only.`,
            });
          }
        }
      } catch { /* drive check failed */ }
    }

    console.log(`[copilot-readiness] sharepoint: found ${findings.length} findings from ${groups.length} groups`);
  } catch (e: any) {
    // Rethrow so outer safeRun can catch and show permission warning
    throw e;
  }
  return findings;
}

async function scanTeams(graph: GraphClient): Promise<Finding[]> {
  const findings: Finding[] = [];
  try {
    // Get all teams
    const groups = await graph.getAllPages<any>("/v1.0/groups", {
      $filter: "resourceProvisioningOptions/Any(x:x eq 'Team')",
      $select: "id,displayName,visibility,description",
      $top: "100",
    }, 5);

    for (const group of groups) {
      // Public teams = visible and joinable by anyone
      if (group.visibility === "Public") {
        try {
          const channels = await graph.getAllPages<any>(
            `/v1.0/teams/${group.id}/channels`,
            { $select: "id,displayName,membershipType,description" },
            2
          );

          const publicChannels = channels.filter(
            (c: any) => c.membershipType === "standard"
          );

          if (publicChannels.length > 0) {
            findings.push({
              id: uuidv4(),
              category: "teams",
              severity: "high",
              title: `Public Team "${group.displayName}" with ${publicChannels.length} open channels`,
              description: `This team is marked as "Public" — any employee can join and access all ${publicChannels.length} standard channels. Copilot will surface messages from these channels to all employees.`,
              resource: group.displayName,
              exposedTo: "All employees (public team)",
              remediation: `Go to Teams → ${group.displayName} → Settings → Change team privacy from "Public" to "Private". Review channel contents for sensitive data.`,
            });
          }
        } catch {
          // Channel listing failed — skip
        }
      }
    }
  } catch (e: any) {
    throw e;
  }
  return findings;
}

async function scanOneDrive(graph: GraphClient): Promise<Finding[]> {
  const findings: Finding[] = [];
  try {
    // Get all drives in the tenant via /v1.0/drives (requires Files.Read.All)
    const drives = await graph.getAllPages<any>("/v1.0/drives", {
      $select: "id,name,owner,driveType",
      $top: "100",
    }, 3).catch(() => []);
    console.log(`[copilot-readiness] onedrive: found ${drives.length} drives`);

    for (const drive of drives.slice(0, 100)) {
      try {
        const ownerName = drive.owner?.user?.displayName || drive.name || "Unknown";
        // Get root children
        const items = await graph.getAllPages<any>(
          `/v1.0/drives/${drive.id}/root/children`,
          { $select: "id,name,webUrl,folder,file", $top: "50" },
          2
        ).catch(() => []);

        for (const item of items) {
          try {
            // Per MS docs: check /permissions on each item — this is the only
            // reliable way to get sharing link scope. The 'shared' facet on
            // driveItem doesn't populate on list operations.
            const permsResp = await graph.get<{ value: any[] }>(
              `/v1.0/drives/${drive.id}/items/${item.id}/permissions`
            );
            for (const perm of (permsResp.value || [])) {
              const link = perm.link;
              if (!link) continue;
              const scope: string = link.scope || "";
              const type: string = link.type || "";
              if (scope === "organization" || scope === "anonymous") {
                console.log(`[copilot-readiness] onedrive FOUND: "${item.name}" (${ownerName}) scope=${scope} type=${type}`);
                findings.push({
                  id: uuidv4(),
                  category: "onedrive",
                  severity: scope === "anonymous" ? "critical" : (type === "edit" ? "high" : "medium"),
                  title: `"${item.name}" shared ${scope === "anonymous" ? "publicly (no sign-in)" : "with entire org"} — ${ownerName}`,
                  description: `This ${item.folder ? "folder" : "file"} has a "${scope}" sharing link (${type}). ${scope === "anonymous" ? "Anyone with the link can access it without signing in." : "All employees in the organization can access it."} When Copilot is enabled it will surface this content.`,
                  resource: `${ownerName}/${item.name}`,
                  resourceUrl: item.webUrl,
                  exposedTo: scope === "anonymous" ? "Anyone (no sign-in required)" : "Entire organization",
                  remediation: `Open ${item.webUrl} → Share → Manage Access → Remove the "${scope}" sharing link and use "Specific people" instead.`,
                });
              }
            }
          } catch { /* permission check failed for item — skip */ }
        }
      } catch { /* drive inaccessible — skip */ }
    }
    console.log(`[copilot-readiness] onedrive: complete — ${findings.length} findings`);
  } catch (e: any) {
    throw e;
  }
  return findings;
}

async function scanExchange(graph: GraphClient): Promise<Finding[]> {
  const findings: Finding[] = [];
  try {
    // Check for mailboxes with delegate access
    const users = await graph.getAllPages<any>("/v1.0/users", {
      $select: "id,displayName,userPrincipalName",
      $filter: "accountEnabled eq true",
      $top: "50",
    }, 2);

    console.log(`[copilot-readiness] exchange: scanning ${Math.min(users.length, 20)} of ${users.length} users`);
    for (const user of users.slice(0, 20)) {
      try {
        const settings = await graph.get<any>(
          `/v1.0/users/${user.id}/mailboxSettings`
        );
        // Check if auto-forwarding is enabled (data could leak via Copilot)
        if (settings.automaticRepliesSetting?.status === "alwaysEnabled" ||
            settings.automaticRepliesSetting?.status === "scheduled") {
          // Not a critical finding but worth noting
        }

        // Check mailbox folder permissions
        const folders = await graph.getAllPages<any>(
          `/v1.0/users/${user.id}/mailFolders`,
          { $select: "id,displayName", $top: "10" },
          1
        ).catch(() => []);

        for (const folder of folders.slice(0, 5)) {
          try {
            const perms = await graph.get<{ value: any[] }>(
              `/v1.0/users/${user.id}/mailFolders/${folder.id}/permissions`
            );
            for (const p of perms.value || []) {
              if (p.isDefault === false && p.role !== "none") {
                findings.push({
                  id: uuidv4(),
                  category: "exchange",
                  severity: p.role === "owner" ? "critical" : "high",
                  title: `Delegate access on ${user.displayName}'s "${folder.displayName}" folder`,
                  description: `Someone has "${p.role}" delegate access to ${user.displayName}'s "${folder.displayName}" mail folder. Copilot may surface emails from this folder to the delegate.`,
                  resource: `${user.displayName}/${folder.displayName}`,
                  exposedTo: `Delegate with "${p.role}" role`,
                  remediation: `Review ${user.userPrincipalName}'s mailbox permissions in Exchange Admin Center → Recipients → Mailboxes → Delegation.`,
                });
              }
            }
          } catch {
            // Folder permission check failed — skip
          }
        }
      } catch {
        // User mailbox check failed — skip
      }
    }
  } catch (e: any) {
    throw e;
  }
  return findings;
}

// ── Routes ───────────────────────────────────────────────────────────────

// Run a new scan
router.post("/scan", async (req, res) => {
  const oauthKeyId = req.query.oauth_key_id as string || req.body.oauth_key_id;
  if (!oauthKeyId) {
    res.status(400).json({ error: "oauth_key_id is required" });
    return;
  }

  const db = getDb();

  // Check the key EXISTS before accepting the scan.
  //
  // Only presence was checked, so `?oauth_key_id=none` returned 200
  // {status:"running"}, inserted a scan document, and failed in the background
  // when getValidToken() could not resolve it. Because /results returns the most
  // recent scan regardless of status, that dead scan then MASKED the last good
  // one — a real 376-finding assessment disappeared behind a typo.
  const keyExists = await db.collection("oauth_keys").findOne({ id: String(oauthKeyId) });
  if (!keyExists) {
    res.status(404).json({ error: `Unknown oauth_key_id: ${oauthKeyId}. Connect a Microsoft tenant first.` });
    return;
  }

  const scanId = uuidv4();
  const scan: ScanResult = {
    id: scanId,
    oauthKeyId,
    status: "running",
    startedAt: new Date().toISOString(),
    riskLevel: "none",
    summary: {
      totalFindings: 0, critical: 0, high: 0, medium: 0, low: 0,
      sharepoint: 0, onedrive: 0, teams: 0, exchange: 0,
      highRiskFindings: 0,
    },
    findings: [],
  };

  // Store initial scan state
  await db.collection("copilot_readiness_scans").insertOne({ ...scan });
  res.json({ scanId, status: "running", message: "Scan started" });

  // Run scan in background
  (async () => {
    try {
      const graphToken = await getValidToken(oauthKeyId, "graph");
      const graph = new GraphClient(graphToken);

      // Run all scans in parallel
      const permError = (category: string, perm: string): Finding => ({
        id: uuidv4(),
        category: category as any,
        severity: "medium",
        title: `Cannot scan ${category} — permission not granted`,
        description: `The Azure AD app registration is missing the "${perm}" permission. Grant it in Azure AD → App Registrations → API Permissions → Grant admin consent.`,
        resource: category,
        exposedTo: "Unknown — scan incomplete",
        remediation: `In Azure AD, grant "${perm}" application permission and click "Grant admin consent for your organization".`,
      });

      const safeRun = async (fn: () => Promise<Finding[]>, category: string, perm: string): Promise<Finding[]> => {
        try {
          const results = await fn();
          // If results is empty AND no error, log for debugging
          if (results.length === 0) console.log(`[copilot-readiness] ${category}: scan returned 0 findings`);
          return results;
        } catch (e: any) {
          console.error(`[copilot-readiness] ${category} scan error:`, e?.message || e);
          return [permError(category, perm)];
        }
      };

      const [spFindings, teamsFindings, odFindings, exFindings] = await Promise.all([
        safeRun(() => scanSharePoint(graph), "sharepoint", "Sites.Read.All"),
        safeRun(() => scanTeams(graph), "teams", "Team.ReadBasic.All"),
        safeRun(() => scanOneDrive(graph), "onedrive", "Files.Read.All"),
        safeRun(() => scanExchange(graph), "exchange", "MailboxSettings.Read"),
      ]);

      const allFindings = [...spFindings, ...teamsFindings, ...odFindings, ...exFindings];

      const summary = {
        totalFindings: allFindings.length,
        critical: allFindings.filter(f => f.severity === "critical").length,
        high: allFindings.filter(f => f.severity === "high").length,
        medium: allFindings.filter(f => f.severity === "medium").length,
        low: allFindings.filter(f => f.severity === "low").length,
        sharepoint: allFindings.filter(f => f.category === "sharepoint").length,
        onedrive: allFindings.filter(f => f.category === "onedrive").length,
        teams: allFindings.filter(f => f.category === "teams").length,
        exchange: allFindings.filter(f => f.category === "exchange").length,
        // The count of findings that need attention — NOT a document estimate.
        //
        // This was `high+critical findings × 50`, surfaced in the UI banner as
        // "~1,250 documents potentially exposed". Nothing counts documents
        // anywhere in this scan; the 50 was invented, and a "~" is not enough of a
        // hedge when the output is a specific four-digit number a customer will
        // repeat to their auditor. Multiplying a finding count by a constant does
        // not produce information — it just makes the finding count look like a
        // measurement of exposure.
        //
        // Renamed as well as re-valued so no caller keeps reading a "docs" figure
        // out of it. If real document counts are wanted, they have to come from
        // Graph per overshared resource.
        highRiskFindings: allFindings.filter(f =>
          f.severity === "critical" || f.severity === "high"
        ).length,
      };

      const riskLevel = summary.critical > 0 ? "critical"
        : summary.high > 0 ? "high"
        : summary.medium > 0 ? "medium"
        : summary.low > 0 ? "low" : "none";

      const completedAt = new Date().toISOString();
      const durationMs = new Date(completedAt).getTime() - new Date(scan.startedAt).getTime();

      await db.collection("copilot_readiness_scans").updateOne(
        { id: scanId },
        { $set: {
          status: "completed", completedAt, durationMs, riskLevel,
          summary, findings: allFindings,
        }},
      );
    } catch (e: any) {
      await db.collection("copilot_readiness_scans").updateOne(
        { id: scanId },
        { $set: { status: "failed", error: e.message || String(e), completedAt: new Date().toISOString() }},
      );
    }
  })();
});

// Get latest scan result
router.get("/results", async (req, res) => {
  const oauthKeyId = req.query.oauth_key_id as string;
  const db = getDb();

  const filter: any = {};
  if (oauthKeyId) filter.oauthKeyId = String(oauthKeyId);

  // Prefer the most recent COMPLETED scan; fall back to the most recent scan of
  // any status only when none has ever completed.
  //
  // Taking "latest by startedAt" unconditionally meant one failed run buried the
  // last good assessment: a scan that errored seconds after starting became the
  // newest document, and the dashboard replaced a real 376-finding report with a
  // permanently-"running" shell that the UI then polled forever. A failed attempt
  // should never destroy the last known-good answer.
  const [completed] = await db.collection("copilot_readiness_scans")
    .find({ ...filter, status: "completed" })
    .sort({ startedAt: -1 })
    .limit(1)
    .project({ _id: 0 })
    .toArray();

  const [newest] = await db.collection("copilot_readiness_scans")
    .find(filter)
    .sort({ startedAt: -1 })
    .limit(1)
    .project({ _id: 0 })
    .toArray();

  if (!completed && !newest) {
    res.json({ scan: null });
    return;
  }

  // If a newer scan is mid-flight or failed, say so alongside the good result
  // rather than silently showing stale data as if it were current.
  const scan = completed || newest;
  const superseded = newest && completed && newest.id !== completed.id
    ? { id: newest.id, status: newest.status, startedAt: newest.startedAt }
    : null;

  res.json({ scan, ...(superseded ? { latest_attempt: superseded } : {}) });
});

// Get scan by ID
router.get("/results/:scanId", async (req, res) => {
  const db = getDb();
  const scan = await db.collection("copilot_readiness_scans")
    .findOne({ id: req.params.scanId }, { projection: { _id: 0 } });
  if (!scan) { res.status(404).json({ error: "Scan not found" }); return; }
  res.json({ scan });
});

// List all scans
router.get("/history", async (req, res) => {
  const db = getDb();
  const scans = await db.collection("copilot_readiness_scans")
    .find({})
    .sort({ startedAt: -1 })
    .limit(20)
    .project({ _id: 0, findings: 0 })
    .toArray();
  res.json({ scans });
});

export default router;
