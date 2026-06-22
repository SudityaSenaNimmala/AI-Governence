/**
 * Agent Governance sub-app — mounts all governance API routes.
 * Imported and mounted by the main server's index.js.
 */
import { Router } from "express";
import oauthKeysRouter from "./routes/oauthKeys.js";
import authRouter from "./routes/auth.js";
import discoveryRouter from "./routes/discovery.js";
import lifecycleRouter from "./routes/lifecycle.js";
import policiesRouter from "./routes/policies.js";
import activityRouter from "./routes/activity.js";
import azureRouter from "./routes/azure.js";
import googleRouter from "./routes/google.js";
import geminiEnterpriseRouter from "./routes/geminiEnterprise.js";
import openaiRouter from "./routes/openai.js";
import claudeRouter from "./routes/claude.js";
import alertsRouter from "./routes/alerts.js";
import costRouter from "./routes/cost.js";
import sensitivityRouter from "./routes/sensitivity.js";
import promptsRouter from "./routes/prompts.js";
import recertificationRouter from "./routes/recertification.js";
import agentMetadataRouter from "./routes/agentMetadata.js";
import capabilitiesRouter from "./routes/capabilities.js";

const governanceRouter = Router();

governanceRouter.use("/api/oauth-keys", oauthKeysRouter);
governanceRouter.use("/api/auth", authRouter);
governanceRouter.use("/api/discovery", discoveryRouter);
governanceRouter.use("/api/lifecycle", lifecycleRouter);
governanceRouter.use("/api/policies", policiesRouter);
governanceRouter.use("/api/activity", activityRouter);
governanceRouter.use("/api/azure", azureRouter);
governanceRouter.use("/api/google", googleRouter);
governanceRouter.use("/api/gemini-enterprise", geminiEnterpriseRouter);
governanceRouter.use("/api/openai", openaiRouter);
governanceRouter.use("/api/claude", claudeRouter);
governanceRouter.use("/api/alerts", alertsRouter);
governanceRouter.use("/api/cost", costRouter);
governanceRouter.use("/api/sensitivity", sensitivityRouter);
governanceRouter.use("/api/prompts", promptsRouter);
governanceRouter.use("/api/recertification", recertificationRouter);
governanceRouter.use("/api/agent-metadata", agentMetadataRouter);
governanceRouter.use("/api/capabilities", capabilitiesRouter);

governanceRouter.get("/api/health", (_req, res) => {
  res.json({ status: "ok", source: "agent-governance", timestamp: new Date().toISOString() });
});

export default governanceRouter;
