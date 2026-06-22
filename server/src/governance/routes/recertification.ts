import { Router } from "express";
import { getDb } from "../db.js";
import { v4 as uuidv4 } from "uuid";

const router = Router();

router.get("/", async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 200, 500);
    const filter: Record<string, any> = {};
    if (req.query.status)   filter.status   = req.query.status;
    if (req.query.agent_id) filter.agent_id = req.query.agent_id;
    if (req.query.platform) filter.platform = req.query.platform;

    const campaigns = await getDb().collection("recertification_campaigns")
      .find(filter, { projection: { _id: 0 } })
      .sort({ created_at: -1 })
      .limit(limit)
      .toArray();
    res.json({ campaigns, totalCount: campaigns.length });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to fetch campaigns" });
  }
});

router.post("/", async (req, res) => {
  try {
    const { agents, due_in_days = 14, escalate_to } = req.body as {
      agents: Array<{
        id: string; name: string; platform?: string;
        ownerEmail?: string; ownerName?: string;
        owner?: { userPrincipalName?: string; displayName?: string };
        oauth_key_id?: string;
      }>;
      due_in_days?: number;
      escalate_to?: string;
    };

    if (!agents || agents.length === 0) {
      res.status(400).json({ error: "agents array is required" });
      return;
    }

    const dueAt = new Date();
    dueAt.setDate(dueAt.getDate() + Math.max(1, Math.min(due_in_days, 90)));
    const now = new Date();

    const created: string[] = [];
    const skipped: string[] = [];
    const col = getDb().collection("recertification_campaigns");

    for (const agent of agents) {
      const existing = await col.findOne({ agent_id: agent.id, status: "pending" });
      if (existing) { skipped.push(agent.id); continue; }

      const id = uuidv4();
      const ownerEmail = agent.ownerEmail || agent.owner?.userPrincipalName || "";
      const ownerName  = agent.ownerName  || agent.owner?.displayName || "";

      await col.insertOne({
        id, agent_id: agent.id, agent_name: agent.name,
        platform: agent.platform || "unknown",
        owner_email: ownerEmail, owner_name: ownerName,
        sent_at: now, due_at: dueAt, responded_at: null,
        response: null, responder: null, notes: null,
        status: "pending", escalated_at: null, escalated_to: null,
        oauth_key_id: agent.oauth_key_id || null,
        created_at: now, updated_at: now,
      });

      await getDb().collection("governance_audit_log").insertOne({
        id: uuidv4(), event_type: "recertification_launched",
        agent_id: agent.id, agent_name: agent.name, actor: "system",
        details: `Recertification campaign launched, due ${dueAt.toLocaleDateString()}${escalate_to ? `, escalation: ${escalate_to}` : ""}`,
        created_at: now,
      });

      created.push(id);
    }

    res.json({ success: true, campaignsCreated: created.length, skippedDuplicates: skipped.length, ids: created, dueAt });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to create campaigns" });
  }
});

router.patch("/:id/respond", async (req, res) => {
  try {
    const { response, responder, notes } = req.body as {
      response: "approved" | "rejected"; responder?: string; notes?: string;
    };
    if (!["approved", "rejected"].includes(response)) {
      res.status(400).json({ error: "response must be 'approved' or 'rejected'" });
      return;
    }

    const now = new Date();
    const result = await getDb().collection("recertification_campaigns").findOneAndUpdate(
      { id: req.params.id, status: "pending" },
      { $set: { response, responder: responder || "unknown", notes: notes || "", responded_at: now, status: response, updated_at: now } },
      { returnDocument: "after", projection: { _id: 0 } }
    );

    if (!result) {
      res.status(404).json({ error: "Campaign not found or already responded" });
      return;
    }

    await getDb().collection("governance_audit_log").insertOne({
      id: uuidv4(),
      event_type: response === "approved" ? "recertification_approved" : "recertification_rejected",
      agent_id: result.agent_id, agent_name: result.agent_name,
      actor: responder || "unknown",
      details: notes || `Recertification ${response}`,
      created_at: now,
    });

    res.json({ success: true, campaign: result });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to record response" });
  }
});

router.patch("/:id/escalate", async (req, res) => {
  try {
    const { escalated_to = "admin" } = req.body;
    const now = new Date();

    const result = await getDb().collection("recertification_campaigns").findOneAndUpdate(
      { id: req.params.id, status: "pending" },
      { $set: { status: "escalated", escalated_at: now, escalated_to, updated_at: now } },
      { returnDocument: "after", projection: { _id: 0 } }
    );

    if (!result) {
      res.status(404).json({ error: "Campaign not found or already closed" });
      return;
    }

    await getDb().collection("governance_audit_log").insertOne({
      id: uuidv4(), event_type: "recertification_escalated",
      agent_id: result.agent_id, agent_name: result.agent_name,
      actor: "system", details: `Escalated to ${escalated_to}`,
      created_at: now,
    });

    res.json({ success: true, campaign: result });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to escalate" });
  }
});

router.post("/expire-overdue", async (req, res) => {
  try {
    const now = new Date();
    const col = getDb().collection("recertification_campaigns");

    const overdue = await col.find({ status: "pending", due_at: { $lt: now } }, { projection: { _id: 0, id: 1, agent_id: 1, agent_name: 1 } }).toArray();

    if (overdue.length > 0) {
      await col.updateMany(
        { status: "pending", due_at: { $lt: now } },
        { $set: { status: "expired", updated_at: now } }
      );

      for (const row of overdue) {
        await getDb().collection("governance_audit_log").insertOne({
          id: uuidv4(), event_type: "recertification_expired",
          agent_id: row.agent_id, agent_name: row.agent_name,
          actor: "system", details: "Campaign expired without owner response",
          created_at: now,
        });
      }
    }

    res.json({ success: true, expired: overdue.length, campaigns: overdue });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to expire campaigns" });
  }
});

router.get("/stats", async (req, res) => {
  try {
    const col = getDb().collection("recertification_campaigns");
    const now = new Date();
    const total     = await col.countDocuments();
    const pending   = await col.countDocuments({ status: "pending" });
    const approved  = await col.countDocuments({ status: "approved" });
    const rejected  = await col.countDocuments({ status: "rejected" });
    const escalated = await col.countDocuments({ status: "escalated" });
    const expired   = await col.countDocuments({ status: "expired" });
    const overdue   = await col.countDocuments({ status: "pending", due_at: { $lt: now } });

    res.json({ total, pending, approved, rejected, escalated, expired, overdue });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to get stats" });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    await getDb().collection("recertification_campaigns").deleteOne({ id: req.params.id });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to delete campaign" });
  }
});

export default router;
