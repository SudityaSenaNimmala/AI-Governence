import { Router } from "express";
import { PLATFORM_CAPABILITIES } from "../config/platformCapabilities.js";

const router = Router();

/**
 * GET /api/capabilities — full per-platform capability matrix.
 * The frontend uses this to show / gate / hide tabs per platform:
 *   "supported"   → show the tab
 *   "limited"     → show the tab with the `note` (and `requires`) as a banner
 *   "unsupported" → hide the tab
 */
router.get("/", (_req, res) => {
  res.json({ capabilities: PLATFORM_CAPABILITIES });
});

/**
 * GET /api/capabilities/:platform — capabilities for one platform
 * (microsoft | google | openai | claude).
 */
router.get("/:platform", (req, res) => {
  const platform = req.params.platform.toLowerCase();
  const caps = PLATFORM_CAPABILITIES[platform];
  if (!caps) {
    res.status(404).json({
      error: `Unknown platform "${platform}". Valid: ${Object.keys(PLATFORM_CAPABILITIES).join(", ")}`,
    });
    return;
  }
  res.json(caps);
});

export default router;
