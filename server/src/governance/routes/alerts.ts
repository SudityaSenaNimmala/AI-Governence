import { Router, Request, Response } from "express";
import { getDb } from "../db.js";
import crypto from "node:crypto";

const router = Router();

// GET /api/alerts/config — fetch alert configuration
router.get("/config", async (_req: Request, res: Response) => {
  try {
    const db = getDb();
    const doc = await db.collection("alert_config").findOne({}, { sort: { created_at: -1 } });
    if (!doc) {
      return res.json({
        idle_threshold_minutes: 43200,
        enabled: true,
        notify_microsoft: true,
        notify_google: true,
        created_at: new Date().toISOString(),
      });
    }
    res.json(doc);
  } catch (err: any) {
    res.json({
      idle_threshold_minutes: 43200,
      enabled: true,
      notify_microsoft: true,
      notify_google: true,
      created_at: new Date().toISOString(),
    });
  }
});

// PUT /api/alerts/config — update alert configuration
router.put("/config", async (req: Request, res: Response) => {
  const {
    idle_threshold_minutes = 43200,
    enabled = true,
    notify_microsoft = true,
    notify_google = true,
  } = req.body;
  try {
    const db = getDb();
    await db.collection("alert_config").updateOne(
      {},
      {
        $set: { idle_threshold_minutes, enabled, notify_microsoft, notify_google, updated_at: new Date() },
        $setOnInsert: { created_at: new Date() },
      },
      { upsert: true }
    );
    res.json({ idle_threshold_minutes, enabled, notify_microsoft, notify_google });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/alerts — create a new alert record
router.post("/", async (req: Request, res: Response) => {
  const { agent_id, agent_name, vendor, platform, alert_type, message, idle_minutes } = req.body;
  try {
    const db = getDb();
    const id = crypto.randomUUID();
    const now = new Date();
    const doc = {
      id,
      agent_id,
      agent_name,
      vendor,
      platform,
      alert_type: alert_type || "idle_agent",
      message,
      idle_minutes,
      resolved: false,
      created_at: now,
      updated_at: now,
    };
    await db.collection("alerts").insertOne(doc);
    res.json(doc);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/alerts — list alerts with optional filters
router.get("/", async (req: Request, res: Response) => {
  const limit = parseInt(req.query.limit as string) || 100;
  const vendor = req.query.vendor as string;
  const resolved = req.query.resolved as string;

  try {
    const db = getDb();
    const filter: Record<string, any> = {};

    if (vendor) filter.vendor = vendor;
    if (resolved === "true") filter.resolved = true;
    else if (resolved === "false") filter.resolved = false;

    const rows = await db.collection("alerts")
      .find(filter)
      .sort({ created_at: -1 })
      .limit(limit)
      .toArray();

    res.json({ alerts: rows, total: rows.length });
  } catch (err: any) {
    res.json({ alerts: [], total: 0 });
  }
});

// POST /api/alerts/check — check agents for idle status and generate alerts
router.post("/check", async (req: Request, res: Response) => {
  const { agents, idle_threshold_minutes = 43200 } = req.body;
  if (!agents || !Array.isArray(agents)) {
    return res.status(400).json({ error: "agents array is required" });
  }

  const now = Date.now();
  const thresholdMs = idle_threshold_minutes * 60 * 1000;
  const idleAlerts: any[] = [];

  for (const agent of agents) {
    const lastActive = agent.activity?.lastActiveTimestamp
      ? new Date(agent.activity.lastActiveTimestamp).getTime()
      : agent.lastModified
        ? new Date(agent.lastModified).getTime()
        : null;

    const isIdle = !lastActive || (now - lastActive) > thresholdMs;

    if (isIdle) {
      const idleMinutes = lastActive ? Math.round((now - lastActive) / 60000) : null;
      idleAlerts.push({
        agent_id: agent.id,
        agent_name: agent.name,
        vendor: agent.vendor || "Unknown",
        platform: agent.platform || "unknown",
        alert_type: "idle_agent",
        idle_minutes: idleMinutes,
        last_active: lastActive ? new Date(lastActive).toISOString() : null,
        message: idleMinutes
          ? `${agent.name} has been idle for ${Math.floor(idleMinutes / 1440)} day(s)`
          : `${agent.name} has no recorded activity`,
        severity: idleMinutes && idleMinutes > 129600 ? "high" : idleMinutes && idleMinutes > 86400 ? "medium" : "low",
      });
    }
  }

  // Persist new alerts to DB
  const db = getDb();
  for (const alert of idleAlerts) {
    try {
      await db.collection("alerts").updateOne(
        { agent_id: alert.agent_id, alert_type: alert.alert_type, resolved: false },
        {
          $set: { message: alert.message, idle_minutes: alert.idle_minutes, updated_at: new Date() },
          $setOnInsert: {
            id: crypto.randomUUID(),
            agent_id: alert.agent_id,
            agent_name: alert.agent_name,
            vendor: alert.vendor,
            platform: alert.platform,
            alert_type: alert.alert_type,
            resolved: false,
            created_at: new Date(),
          },
        },
        { upsert: true }
      );
    } catch {
      // Ignore DB errors — alerts are still returned in-memory
    }
  }

  res.json({
    total_checked: agents.length,
    idle_count: idleAlerts.length,
    microsoft_idle: idleAlerts.filter((a) => a.vendor === "Microsoft").length,
    google_idle: idleAlerts.filter((a) => a.vendor === "Google").length,
    alerts: idleAlerts,
    threshold_minutes: idle_threshold_minutes,
    checked_at: new Date().toISOString(),
  });
});

// PATCH /api/alerts/:id/resolve — resolve an alert
router.patch("/:id/resolve", async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const result = await db.collection("alerts").findOneAndUpdate(
      { id: req.params.id },
      { $set: { resolved: true, resolved_at: new Date(), updated_at: new Date() } },
      { returnDocument: "after" }
    );
    if (!result) return res.status(404).json({ error: "Alert not found" });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/alerts/resolve-all — resolve all unresolved alerts
router.post("/resolve-all", async (_req: Request, res: Response) => {
  try {
    const db = getDb();
    const result = await db.collection("alerts").updateMany(
      { resolved: false },
      { $set: { resolved: true, resolved_at: new Date(), updated_at: new Date() } }
    );
    res.json({ resolved: result.modifiedCount });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
