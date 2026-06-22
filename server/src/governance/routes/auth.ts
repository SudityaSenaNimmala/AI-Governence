import { Router } from "express";
import { acquireNewToken } from "../services/tokenManager.js";

const router = Router();

// Acquire token using stored credentials
router.post("/token", async (req, res) => {
  try {
    const { oauth_key_id } = req.body;

    if (!oauth_key_id) {
      res.status(400).json({ error: "oauth_key_id is required" });
      return;
    }

    const token = await acquireNewToken(oauth_key_id);

    // Never expose the token to frontend — just confirm success
    res.json({
      success: true,
      message: "Token acquired successfully",
      // Only expose metadata, not the token itself
      acquired_at: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Token acquisition failed";
    console.error("Token acquisition error:", message, err instanceof Error ? err.stack : "");
    const statusCode = message.includes("not found") ? 404 : 400;
    const userMessage = message.includes("AADSTS")
      ? message
      : message.includes("not found")
        ? "OAuth credentials not found. Please reconnect."
        : `Microsoft authentication failed: ${message}`;
    res.status(statusCode).json({ error: userMessage });
  }
});

export default router;
