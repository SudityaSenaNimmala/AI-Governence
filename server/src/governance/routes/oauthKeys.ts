import { Router } from "express";
import { getDb } from "../db.js";
import { encrypt } from "../crypto.js";
import crypto from "node:crypto";

const router = Router();

// Save new OAuth credentials
router.post("/", async (req, res) => {
  try {
    const { vendor, client_id, client_secret, tenant_id, redirect_uri, dataverse_env_url, azure_subscription_id, google_admin_email, google_project_id } = req.body;

    if (!vendor || !client_id || !client_secret) {
      res.status(400).json({ error: "vendor, client_id, and client_secret are required" });
      return;
    }

    // For Google vendor: client_id = service account email, client_secret = service account JSON key
    if (vendor === "google") {
      try {
        const parsed = JSON.parse(client_secret);
        if (!parsed.private_key || !parsed.client_email) {
          res.status(400).json({ error: "Google service account key must contain private_key and client_email" });
          return;
        }
      } catch {
        res.status(400).json({ error: "Google client_secret must be a valid service account JSON key" });
        return;
      }
      if (!google_admin_email) {
        res.status(400).json({ error: "google_admin_email is required for Google Workspace (admin user for domain-wide delegation)" });
        return;
      }
    }

    const encryptedSecret = encrypt(client_secret);
    const db = getDb();

    // Upsert: if a key already exists for this vendor+client_id+tenant_id, update it instead of creating a duplicate
    const existing = await db.collection("oauth_keys").findOne({
      vendor,
      client_id,
      tenant_id: tenant_id || null,
    });

    let doc;
    if (existing) {
      const updateFields: Record<string, any> = {
        client_secret: encryptedSecret,
        redirect_uri: redirect_uri || null,
        updated_at: new Date(),
      };
      if (dataverse_env_url) updateFields.dataverse_env_url = dataverse_env_url;
      if (azure_subscription_id) updateFields.azure_subscription_id = azure_subscription_id;
      if (google_admin_email) updateFields.google_admin_email = google_admin_email;
      if (google_project_id) updateFields.google_project_id = google_project_id;

      await db.collection("oauth_keys").updateOne(
        { id: existing.id },
        { $set: updateFields }
      );
      const updated = await db.collection("oauth_keys").findOne(
        { id: existing.id },
        { projection: { _id: 0, client_secret: 0 } }
      );
      doc = updated;
    } else {
      const id = crypto.randomUUID();
      const now = new Date();
      const newDoc = {
        id,
        vendor,
        client_id,
        client_secret: encryptedSecret,
        tenant_id: tenant_id || null,
        redirect_uri: redirect_uri || null,
        dataverse_env_url: dataverse_env_url || null,
        azure_subscription_id: azure_subscription_id || null,
        google_admin_email: google_admin_email || null,
        google_project_id: google_project_id || null,
        created_at: now,
        updated_at: now,
      };
      await db.collection("oauth_keys").insertOne(newDoc);
      const { client_secret: _s, _id, ...rest } = newDoc as any;
      doc = rest;
    }

    res.json(doc);
  } catch (err) {
    console.error("Failed to save OAuth keys:", err instanceof Error ? err.message : err, err instanceof Error ? err.stack : "");
    res.status(500).json({ error: "Failed to save credentials", detail: err instanceof Error ? err.message : String(err) });
  }
});

// List saved vendors (masked secrets)
router.get("/", async (_req, res) => {
  try {
    const db = getDb();
    const rows = await db.collection("oauth_keys")
      .find({}, {
        projection: {
          _id: 0,
          client_secret: 0,
        },
      })
      .sort({ created_at: -1 })
      .toArray();

    const masked = rows.map((row: any) => ({
      ...row,
      client_id_masked: row.client_id.slice(0, 8) + "..." + row.client_id.slice(-4),
    }));

    res.json(masked);
  } catch (err) {
    console.error("Failed to list OAuth keys:", err);
    res.status(500).json({ error: "Failed to fetch credentials" });
  }
});

// Update connection sources (add Dataverse URL, Azure Subscription, etc.)
router.patch("/:id", async (req, res) => {
  try {
    const { dataverse_env_url, azure_subscription_id, google_admin_email, google_project_id } = req.body;
    const db = getDb();

    const updateFields: Record<string, any> = { updated_at: new Date() };
    if (dataverse_env_url !== undefined && dataverse_env_url !== null) updateFields.dataverse_env_url = dataverse_env_url;
    if (azure_subscription_id !== undefined && azure_subscription_id !== null) updateFields.azure_subscription_id = azure_subscription_id;
    if (google_admin_email !== undefined && google_admin_email !== null) updateFields.google_admin_email = google_admin_email;
    if (google_project_id !== undefined && google_project_id !== null) updateFields.google_project_id = google_project_id;

    const result = await db.collection("oauth_keys").findOneAndUpdate(
      { id: req.params.id },
      { $set: updateFields },
      { returnDocument: "after", projection: { _id: 0, client_secret: 0 } }
    );

    if (!result) {
      res.status(404).json({ error: "OAuth key not found" });
      return;
    }
    res.json(result);
  } catch (err) {
    console.error("Failed to update OAuth key:", err);
    res.status(500).json({ error: "Failed to update credentials" });
  }
});

// Delete credentials + cascade tokens
router.delete("/:id", async (req, res) => {
  try {
    const db = getDb();
    await db.collection("oauth_keys").deleteOne({ id: req.params.id });
    res.json({ success: true });
  } catch (err) {
    console.error("Failed to delete OAuth keys:", err);
    res.status(500).json({ error: "Failed to delete credentials" });
  }
});

export default router;
