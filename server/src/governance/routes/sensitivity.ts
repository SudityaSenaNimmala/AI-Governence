import { Router } from "express";
import { getValidToken } from "../services/tokenManager.js";
import { GraphClient } from "../services/graphClient.js";
import { getDb } from "../db.js";
import { v4 as uuidv4 } from "uuid";

const router = Router();

type SensitivityStatus = "covered" | "partial" | "uncovered" | "unknown";

function getSensitivityStatus(coveragePercent: number): SensitivityStatus {
  if (coveragePercent >= 80) return "covered";
  if (coveragePercent >= 40) return "partial";
  if (coveragePercent > 0) return "partial";
  return "uncovered";
}

router.get("/check", async (req, res) => {
  const oauthKeyId = req.query.oauth_key_id as string;
  if (!oauthKeyId) { res.status(400).json({ error: "oauth_key_id is required" }); return; }

  try {
    const graphToken = await getValidToken(oauthKeyId, "graph");
    const graphClient = new GraphClient(graphToken);

    let availableLabels: any[] = [];
    try {
      const labelsResult = await graphClient.get<{ value: any[] }>(
        "/v1.0/security/informationProtection/sensitivityLabels"
      );
      availableLabels = labelsResult.value || [];
    } catch { /* optional permission */ }

    let sites: any[] = [];
    try {
      sites = await graphClient.getAllPages<any>(
        "/v1.0/sites",
        { search: "*", $select: "id,name,webUrl", $top: "30" },
        2
      );
    } catch { /* sites may not be accessible */ }

    const siteSensitivity: Array<{
      siteId: string; siteName: string; siteUrl: string;
      hasLabel: boolean; labelName?: string;
    }> = [];

    for (const site of sites.slice(0, 20)) {
      let hasLabel = false;
      let labelName: string | undefined;
      try {
        const siteInfo = await graphClient.get<any>(
          `/beta/sites/${site.id}?$select=id,name,sensitivityLabel`
        );
        if (siteInfo.sensitivityLabel?.id) {
          hasLabel = true;
          labelName = siteInfo.sensitivityLabel.displayName || siteInfo.sensitivityLabel.id;
        }
      } catch { /* beta endpoint optional */ }
      siteSensitivity.push({ siteId: site.id, siteName: site.name, siteUrl: site.webUrl, hasLabel, labelName });
    }

    const labeledSites = siteSensitivity.filter(s => s.hasLabel).length;
    const coverage = siteSensitivity.length > 0
      ? Math.round((labeledSites / siteSensitivity.length) * 100)
      : availableLabels.length > 0 ? 0 : -1;

    res.json({
      tenantLabelCount: availableLabels.length,
      labelsConfigured: availableLabels.length > 0,
      availableLabels: availableLabels.slice(0, 30).map((l) => ({
        id: l.id, name: l.name || l.displayName,
        description: l.description, priority: l.priority,
        isEnabled: l.isEnabled !== false,
      })),
      sites: siteSensitivity,
      summary: {
        totalSites: siteSensitivity.length, labeledSites,
        unlabeledSites: siteSensitivity.length - labeledSites,
        coveragePercent: coverage < 0 ? null : coverage,
        status: coverage < 0 ? "labels_not_configured" : getSensitivityStatus(coverage),
      },
      scannedAt: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to check sensitivity labels";
    console.error("[Sensitivity] check error:", message);
    res.status(500).json({ error: message });
  }
});

router.post("/scan-agent", async (req, res) => {
  const { oauth_key_id, agent_id, agent_name, platform, knowledge_sources = [] } = req.body;

  if (!agent_id || !platform) {
    res.status(400).json({ error: "agent_id and platform are required" });
    return;
  }

  let labeledCount = 0;
  let unlabeledCount = 0;
  const sourceResults: any[] = [];

  if (platform === "copilot_studio" && oauth_key_id && knowledge_sources.length > 0) {
    try {
      const graphToken = await getValidToken(oauth_key_id, "graph");
      const graphClient = new GraphClient(graphToken);
      for (const source of knowledge_sources.slice(0, 10)) {
        const url = source.url || "";
        if (url.includes("sharepoint.com")) {
          let hasLabel = false;
          try {
            const siteUrl = new URL(url);
            const pathParts = siteUrl.pathname.split("/sites/");
            if (pathParts.length > 1) {
              const siteName = pathParts[1].split("/")[0];
              const siteInfo = await graphClient.get<any>(
                `/beta/sites/${siteUrl.hostname}:/sites/${siteName}?$select=id,name,sensitivityLabel`
              );
              hasLabel = !!siteInfo.sensitivityLabel?.id;
            }
          } catch { /* ignore */ }
          if (hasLabel) labeledCount++; else unlabeledCount++;
          sourceResults.push({ url, type: "sharepoint", hasLabel });
        } else {
          unlabeledCount++;
          sourceResults.push({ url, type: source.type || "external", hasLabel: false });
        }
      }
    } catch { unlabeledCount += knowledge_sources.length; }

  } else if ((platform === "vertex_ai" || platform === "agent_builder" || platform === "google_chat") && knowledge_sources.length > 0) {
    for (const source of knowledge_sources.slice(0, 10)) {
      const isPublicOrExternal = (source.type || "").toLowerCase().includes("external") || (source.url || "").includes("drive.google.com");
      if (isPublicOrExternal) unlabeledCount++; else labeledCount++;
      sourceResults.push({ url: source.url || source.id || source.name || "", type: source.type || "google_data_store", hasLabel: !isPublicOrExternal, note: "Google Workspace DLP classification (Drive-based)" });
    }

  } else if ((platform === "openai_assistant" || platform === "custom_gpt") && knowledge_sources.length > 0) {
    for (const source of knowledge_sources.slice(0, 10)) {
      unlabeledCount++;
      sourceResults.push({ url: source.name || source.id || "Vector Store", type: "vector_store", hasLabel: false, note: "OpenAI Vector Stores do not support sensitivity labels" });
    }

  } else if ((platform === "claude_project" || platform === "claude_ai_project") && knowledge_sources.length > 0) {
    for (const source of knowledge_sources.slice(0, 10)) {
      unlabeledCount++;
      sourceResults.push({ url: source.name || source.id || "Project File", type: "claude_project_file", hasLabel: false, note: "Claude Projects do not support sensitivity labels" });
    }

  } else {
    sourceResults.push({ url: "", type: platform, hasLabel: false, note: "No knowledge sources detected" });
    unlabeledCount = 0;
  }

  const total = labeledCount + unlabeledCount;
  const coveragePercent = total > 0 ? Math.round((labeledCount / total) * 100) : 0;

  await getDb().collection("agent_sensitivity").updateOne(
    { agent_id, platform },
    {
      $set: {
        agent_id, platform,
        labeled_count: labeledCount, unlabeled_count: unlabeledCount,
        coverage_percent: coveragePercent,
        knowledge_sources: sourceResults,
        scanned_at: new Date(),
      },
      $setOnInsert: { id: uuidv4() },
    },
    { upsert: true }
  );

  res.json({
    agentId: agent_id, agentName: agent_name, platform,
    labeledCount, unlabeledCount, coveragePercent,
    knowledgeSources: sourceResults,
    sensitivityStatus: getSensitivityStatus(coveragePercent),
    scannedAt: new Date().toISOString(),
  });
});

router.get("/agent/:agent_id", async (req, res) => {
  try {
    const doc = await getDb().collection("agent_sensitivity")
      .findOne({ agent_id: req.params.agent_id }, { projection: { _id: 0 }, sort: { scanned_at: -1 } });
    if (!doc) {
      res.json({ agentId: req.params.agent_id, status: "not_scanned" });
      return;
    }
    res.json({
      agentId: doc.agent_id, platform: doc.platform,
      labeledCount: doc.labeled_count, unlabeledCount: doc.unlabeled_count,
      coveragePercent: doc.coverage_percent,
      knowledgeSources: doc.knowledge_sources,
      sensitivityStatus: getSensitivityStatus(doc.coverage_percent as number),
      scannedAt: doc.scanned_at,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to get sensitivity data" });
  }
});

router.get("/summary", async (req, res) => {
  try {
    const col = getDb().collection("agent_sensitivity");
    const pipeline = await col.aggregate([
      {
        $group: {
          _id: null,
          total_agents: { $sum: 1 },
          total_labeled: { $sum: "$labeled_count" },
          total_unlabeled: { $sum: "$unlabeled_count" },
          avg_coverage: { $avg: "$coverage_percent" },
          uncovered_agents: {
            $sum: { $cond: [{ $and: [{ $eq: ["$coverage_percent", 0] }, { $gt: [{ $add: ["$labeled_count", "$unlabeled_count"] }, 0] }] }, 1, 0] },
          },
          covered_agents: { $sum: { $cond: [{ $gte: ["$coverage_percent", 80] }, 1, 0] } },
          partial_agents: {
            $sum: { $cond: [{ $and: [{ $gt: ["$coverage_percent", 0] }, { $lt: ["$coverage_percent", 80] }] }, 1, 0] },
          },
        },
      },
    ]).toArray();

    const stats = pipeline[0] || {
      total_agents: 0, total_labeled: 0, total_unlabeled: 0,
      avg_coverage: 0, uncovered_agents: 0, covered_agents: 0, partial_agents: 0,
    };
    if (stats.avg_coverage != null) stats.avg_coverage = Math.round(stats.avg_coverage);
    delete stats._id;
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to get sensitivity summary" });
  }
});

export default router;
