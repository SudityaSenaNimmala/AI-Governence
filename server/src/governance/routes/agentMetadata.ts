import { Router } from "express";
import { getDb } from "../db.js";
import { v4 as uuidv4 } from "uuid";

const router = Router();

const DATA_CLASSIFICATIONS = ["unclassified", "internal", "confidential", "restricted"] as const;

router.get("/", async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 200, 500);
    const filter: Record<string, any> = {};
    if (req.query.data_classification) filter.data_classification = req.query.data_classification;
    if (req.query.business_unit) filter.business_unit = { $regex: req.query.business_unit as string, $options: "i" };
    if (req.query.platform) filter.platform = req.query.platform;

    const records = await getDb().collection("agent_metadata")
      .find(filter, { projection: { _id: 0 } })
      .sort({ updated_at: -1 })
      .limit(limit)
      .toArray();
    res.json({ records, totalCount: records.length });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to list metadata" });
  }
});

router.get("/stats/summary", async (req, res) => {
  try {
    const col = getDb().collection("agent_metadata");
    const total = await col.countDocuments();

    const byClassification = await col.aggregate([
      { $group: { _id: "$data_classification", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $project: { _id: 0, data_classification: "$_id", count: 1 } },
    ]).toArray();

    const byBusinessUnit = await col.aggregate([
      { $match: { business_unit: { $ne: null } } },
      { $group: { _id: "$business_unit", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
      { $project: { _id: 0, business_unit: "$_id", count: 1 } },
    ]).toArray();

    res.json({ total, byClassification, byBusinessUnit });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to get stats" });
  }
});

router.get("/:agent_id", async (req, res) => {
  try {
    const doc = await getDb().collection("agent_metadata").findOne(
      { agent_id: req.params.agent_id },
      { projection: { _id: 0 } }
    );
    if (!doc) {
      res.json({ agentId: req.params.agent_id, exists: false });
      return;
    }
    res.json({ ...doc, exists: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to get metadata" });
  }
});

router.put("/:agent_id", async (req, res) => {
  try {
    const { agent_id } = req.params;
    const {
      agent_name, platform, purpose, business_unit,
      data_classification, use_case_category,
      approved_by, approved_at, notes, tags,
    } = req.body;

    if (data_classification && !(DATA_CLASSIFICATIONS as readonly string[]).includes(data_classification)) {
      res.status(400).json({ error: `data_classification must be one of: ${DATA_CLASSIFICATIONS.join(", ")}` });
      return;
    }

    const now = new Date();
    const doc = {
      agent_id,
      agent_name: agent_name || null,
      platform: platform || null,
      purpose: purpose || null,
      business_unit: business_unit || null,
      data_classification: data_classification || "unclassified",
      use_case_category: use_case_category || null,
      approved_by: approved_by || null,
      approved_at: approved_at ? new Date(approved_at) : null,
      notes: notes || null,
      tags: tags || [],
      updated_at: now,
    };

    await getDb().collection("agent_metadata").updateOne(
      { agent_id },
      { $set: doc, $setOnInsert: { id: uuidv4(), created_at: now } },
      { upsert: true }
    );

    await getDb().collection("governance_audit_log").insertOne({
      id: uuidv4(),
      event_type: "metadata_updated",
      agent_id,
      agent_name: agent_name || "",
      actor: approved_by || "admin",
      details: [
        data_classification ? `classification=${data_classification}` : null,
        business_unit ? `unit=${business_unit}` : null,
        purpose ? `purpose recorded` : null,
      ].filter(Boolean).join(", ") || "metadata saved",
      created_at: now,
    });

    const saved = await getDb().collection("agent_metadata").findOne({ agent_id }, { projection: { _id: 0 } });
    res.json({ success: true, metadata: saved });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to save metadata" });
  }
});

router.delete("/:agent_id", async (req, res) => {
  try {
    await getDb().collection("agent_metadata").deleteOne({ agent_id: req.params.agent_id });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to delete metadata" });
  }
});

export default router;
