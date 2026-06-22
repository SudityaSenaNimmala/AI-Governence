import { Router } from "express";
import { getDb } from "../db.js";
import { encrypt, decrypt } from "../crypto.js";
import crypto from "node:crypto";

const router = Router();

const ANTHROPIC_BASE = "https://api.anthropic.com";

function anthropicHeaders(apiKey: string): Record<string, string> {
  return { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "Content-Type": "application/json" };
}

const CLAUDE_AI_BASE = "https://claude.ai";

function claudeAIHeaders(sessionKey: string): Record<string, string> {
  return {
    Cookie: `sessionKey=${sessionKey}`,
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    Accept: "application/json, text/plain, */*", "Accept-Language": "en-US,en;q=0.9", "Accept-Encoding": "gzip, deflate, br",
    "Content-Type": "application/json", Referer: "https://claude.ai/", Origin: "https://claude.ai",
    "sec-ch-ua": '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
    "sec-ch-ua-mobile": "?0", "sec-ch-ua-platform": '"Windows"',
    "Sec-Fetch-Dest": "empty", "Sec-Fetch-Mode": "cors", "Sec-Fetch-Site": "same-origin",
  };
}

async function loadClaudeKey(oauthKeyId: string) {
  const db = getDb();
  const row = await db.collection("oauth_keys").findOne({ id: oauthKeyId, vendor: "claude" });
  if (!row) {
    const e: any = new Error("Claude credentials not found");
    e.status = 404;
    throw e;
  }
  return {
    apiKey: decrypt(row.client_secret),
    sessionKey: row.redirect_uri ? decrypt(row.redirect_uri) : null,
  };
}

router.post("/connect", async (req, res) => {
  try {
    const { api_key, session_key } = req.body as { api_key?: string; session_key?: string };
    if (!api_key?.trim()) return res.status(400).json({ error: "Anthropic API key is required" });

    const db = getDb();

    if (api_key.trim() === "__USE_EXISTING__") {
      const existing = await db.collection("oauth_keys").findOne({ vendor: "claude" });
      if (!existing) return res.status(404).json({ error: "No saved Claude credentials found" });
      if (session_key?.trim()) {
        await db.collection("oauth_keys").updateOne({ id: existing.id }, { $set: { redirect_uri: encrypt(session_key.trim()), updated_at: new Date() } });
      }
      return res.json({ id: existing.id, vendor: "claude", connected: true });
    }

    const trimmedKey = api_key.trim();
    const isAdminKey = trimmedKey.startsWith("sk-ant-admin");

    if (!isAdminKey) {
      const testRes = await fetch(`${ANTHROPIC_BASE}/v1/models`, { headers: anthropicHeaders(trimmedKey) });
      if (!testRes.ok) {
        const e = await testRes.json().catch(() => ({})) as any;
        return res.status(400).json({ error: `Invalid API key: ${e?.error?.message || testRes.statusText}` });
      }
    }

    const encryptedKey = encrypt(api_key.trim());
    const encryptedSession = session_key?.trim() ? encrypt(session_key.trim()) : null;
    const existing = await db.collection("oauth_keys").findOne({ vendor: "claude" });

    let id: string;
    if (existing) {
      id = existing.id;
      const updates: Record<string, any> = { client_secret: encryptedKey, updated_at: new Date() };
      if (encryptedSession) updates.redirect_uri = encryptedSession;
      await db.collection("oauth_keys").updateOne({ id }, { $set: updates });
    } else {
      id = crypto.randomUUID();
      await db.collection("oauth_keys").insertOne({
        id, vendor: "claude", client_id: "claude-key", client_secret: encryptedKey,
        redirect_uri: encryptedSession, created_at: new Date(), updated_at: new Date(),
      });
    }

    res.json({ id, vendor: "claude", connected: true, hasSessionKey: !!encryptedSession });
  } catch (err: any) {
    res.status(err?.status || 500).json({ error: err.message || "Failed to connect Claude" });
  }
});

// All remaining routes use loadClaudeKey which is already converted. They have NO other DB calls.
// Copy them unchanged except the loadClaudeKey dependency.

router.get("/scan-platform", async (req, res) => {
  try {
    const { oauth_key_id, platform } = req.query as { oauth_key_id?: string; platform?: string };
    if (!oauth_key_id) return res.status(400).json({ error: "oauth_key_id required" });
    if (!platform) return res.status(400).json({ error: "platform required" });
    const { apiKey } = await loadClaudeKey(oauth_key_id);
    const isAdminKey = apiKey.startsWith("sk-ant-admin");

    if (platform === "projects") {
      const adminHeaders = { ...anthropicHeaders(apiKey), "anthropic-beta": "workspaces-2025-01-13" };
      const warnings: string[] = [];
      if (!isAdminKey) { warnings.push("Admin API key required to list Claude.ai Projects."); return res.json({ platform: "projects", projects: [], warnings }); }
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20000);
      let wsRes: Response;
      try { wsRes = await fetch(`${ANTHROPIC_BASE}/v1/organizations/workspaces?limit=100`, { headers: adminHeaders, signal: controller.signal }); } catch (fetchErr: any) { clearTimeout(timeout); warnings.push(`Projects API unavailable: ${fetchErr?.name === "AbortError" ? "Request timed out" : fetchErr?.message}`); return res.json({ platform: "projects", projects: [], warnings }); }
      clearTimeout(timeout);
      if (!wsRes.ok) { const errBody = await wsRes.json().catch(() => ({})) as any; warnings.push(`Claude Workspace API error (HTTP ${wsRes.status}): ${errBody?.error?.message || "unknown"}`); return res.json({ platform: "projects", projects: [], warnings }); }
      const wsData = await wsRes.json() as any;
      const projects = (wsData.data || wsData.workspaces || []).map((ws: any) => ({ id: ws.id, name: ws.name || ws.display_name || `Workspace ${ws.id}`, display_name: ws.display_name || ws.name, description: ws.description || null, created_at: ws.created_at, updated_at: ws.updated_at, status: ws.status || "active", type: "claude_project" }));
      return res.json({ platform: "projects", projects, warnings });
    }

    if (platform === "models") {
      const warnings: string[] = [];
      if (!isAdminKey) {
        const r = await fetch(`${ANTHROPIC_BASE}/v1/models?limit=100`, { headers: anthropicHeaders(apiKey) });
        if (!r.ok) { const e = await r.json().catch(() => ({})) as any; warnings.push(`Models API unavailable (HTTP ${r.status}): ${e?.error?.message}`); return res.json({ platform: "models", models: [], warnings }); }
        const data = await r.json() as any;
        return res.json({ platform: "models", models: (data.data || []).map((m: any) => ({ id: m.id, display_name: m.display_name || m.id, created_at: m.created_at, type: m.type || "model" })), warnings });
      }
      const knownModels = [
        { id: "claude-opus-4-7", display_name: "Claude Opus 4.7", type: "model" },
        { id: "claude-sonnet-4-6", display_name: "Claude Sonnet 4.6", type: "model" },
        { id: "claude-haiku-4-5-20251001", display_name: "Claude Haiku 4.5", type: "model" },
        { id: "claude-3-5-sonnet-20241022", display_name: "Claude 3.5 Sonnet", type: "model" },
        { id: "claude-3-5-haiku-20241022", display_name: "Claude 3.5 Haiku", type: "model" },
        { id: "claude-3-opus-20240229", display_name: "Claude 3 Opus", type: "model" },
        { id: "claude-3-haiku-20240307", display_name: "Claude 3 Haiku", type: "model" },
      ];
      return res.json({ platform: "models", models: knownModels, warnings });
    }

    if (platform === "agents") {
      const adminHeaders = { ...anthropicHeaders(apiKey), "anthropic-beta": "workspaces-2025-01-13" };
      const warnings: string[] = [];
      if (!isAdminKey) { warnings.push("Admin API key required."); return res.json({ platform: "agents", agents: [], warnings }); }
      const wsRes = await fetch(`${ANTHROPIC_BASE}/v1/organizations/workspaces?limit=100`, { headers: adminHeaders });
      if (!wsRes.ok) { const errBody = await wsRes.json().catch(() => ({})) as any; warnings.push(`Claude Workspace API error (HTTP ${wsRes.status}): ${errBody?.error?.message || "unknown"}`); return res.json({ platform: "agents", agents: [], warnings }); }
      const wsData = await wsRes.json() as any;
      const workspaces: any[] = wsData.data || wsData.workspaces || [];
      const wsNameMap: Record<string, string> = {};
      for (const ws of workspaces) wsNameMap[ws.id] = ws.name || ws.display_name || "Default";
      const agents: any[] = [];
      let afterId: string | null = null; let page = 0;
      do {
        const url = `${ANTHROPIC_BASE}/v1/organizations/api_keys?limit=100${afterId ? `&after_id=${afterId}` : ""}`;
        const keysRes = await fetch(url, { headers: adminHeaders });
        if (!keysRes.ok) { warnings.push(`API keys fetch error (HTTP ${keysRes.status})`); break; }
        const keysData = await keysRes.json() as any;
        for (const key of (keysData.data || [])) { agents.push({ id: key.id, name: key.name || `API Key ${key.id}`, workspace_id: key.workspace_id || null, workspace_name: wsNameMap[key.workspace_id] || "Default", created_by: key.created_by?.email || key.created_by?.name || null, status: key.status || "active", created_at: key.created_at, last_used_at: key.last_used_at || null, type: "claude_agent_key" }); }
        afterId = keysData.has_more ? (keysData.data?.[keysData.data.length - 1]?.id || null) : null; page++;
      } while (afterId && page < 20);
      return res.json({ platform: "agents", agents, warnings });
    }

    if (platform === "claude_ai_projects") {
      const { sessionKey: rawSessionKey } = await loadClaudeKey(oauth_key_id);
      const warnings: string[] = [];
      if (!rawSessionKey) { warnings.push("No Claude.ai session key configured."); return res.json({ platform: "claude_ai_projects", projects: [], warnings }); }
      const sessionKey = rawSessionKey.startsWith("sessionKey=") ? rawSessionKey.slice("sessionKey=".length) : rawSessionKey;
      const headers = claudeAIHeaders(sessionKey);
      let orgs: any[] = [];
      try {
        const orgsRes = await fetch(`${CLAUDE_AI_BASE}/api/organizations`, { headers });
        const rawBody = await orgsRes.text();
        if (!orgsRes.ok) {
          const isCloudflare = rawBody.includes("cf-mitigated") || rawBody.includes("Just a moment");
          if (isCloudflare) warnings.push("Cloudflare is blocking server-to-server requests to claude.ai.");
          else warnings.push(`Claude.ai API error (HTTP ${orgsRes.status}): ${rawBody.slice(0, 200)}`);
          return res.json({ platform: "claude_ai_projects", projects: [], warnings });
        }
        const orgsData = (() => { try { return JSON.parse(rawBody); } catch { return null; } })() as any;
        if (!orgsData) { warnings.push("claude.ai returned non-JSON — likely Cloudflare."); return res.json({ platform: "claude_ai_projects", projects: [], warnings }); }
        orgs = Array.isArray(orgsData) ? orgsData : (orgsData.organizations || orgsData.data || []);
        if (orgs.length === 0) { warnings.push("No organizations found — session likely expired."); return res.json({ platform: "claude_ai_projects", projects: [], warnings }); }
      } catch (e: any) { warnings.push(`Failed to reach claude.ai: ${e.message}`); return res.json({ platform: "claude_ai_projects", projects: [], warnings }); }
      const projects: any[] = [];
      for (const org of orgs) {
        const orgId = org.uuid || org.id;
        if (!orgId) continue;
        try {
          const projRes = await fetch(`${CLAUDE_AI_BASE}/api/organizations/${orgId}/projects`, { headers });
          if (!projRes.ok) continue;
          const projData = await projRes.json() as any;
          for (const p of (projData.projects || projData.data || (Array.isArray(projData) ? projData : []))) {
            projects.push({ id: p.uuid || p.id, name: p.name || `Project ${p.uuid || p.id}`, description: p.description || null, created_at: p.created_at, updated_at: p.updated_at, is_private: p.is_private ?? true, org_id: orgId, org_name: org.name || "Unknown Org", type: "claude_ai_project" });
          }
        } catch {}
      }
      return res.json({ platform: "claude_ai_projects", projects, warnings });
    }

    return res.status(400).json({ error: `Unknown platform: ${platform}` });
  } catch (err: any) { res.status(err?.status || 500).json({ error: err.message || "Scan failed" }); }
});

router.get("/debug-admin", async (req, res) => {
  try {
    const { oauth_key_id } = req.query as { oauth_key_id?: string };
    if (!oauth_key_id) return res.status(400).json({ error: "oauth_key_id required" });
    const { apiKey } = await loadClaudeKey(oauth_key_id);
    const isAdmin = apiKey.startsWith("sk-ant-admin");
    const baseHeaders = anthropicHeaders(apiKey);
    const betaHeaders = { ...baseHeaders, "anthropic-beta": "workspaces-2025-01-13" };
    const probe = async (label: string, url: string, headers: Record<string, string>) => { try { const r = await fetch(url, { headers }); const body = await r.json().catch(() => null); return { label, url, status: r.status, ok: r.ok, body }; } catch (e: any) { return { label, url, status: null, ok: false, body: null, error: e?.message }; } };
    const results = await Promise.all([
      probe("GET /v1/organizations", `${ANTHROPIC_BASE}/v1/organizations`, baseHeaders),
      probe("GET /v1/organizations (beta)", `${ANTHROPIC_BASE}/v1/organizations`, betaHeaders),
      probe("GET /v1/organizations/workspaces (beta)", `${ANTHROPIC_BASE}/v1/organizations/workspaces?limit=10`, betaHeaders),
      probe("GET /v1/organizations/api_keys (beta)", `${ANTHROPIC_BASE}/v1/organizations/api_keys?limit=10`, betaHeaders),
      probe("GET /v1/models", `${ANTHROPIC_BASE}/v1/models?limit=10`, baseHeaders),
    ]);
    res.json({ isAdmin, results });
  } catch (err: any) { res.status(err?.status || 500).json({ error: err.message }); }
});

const CLAUDE_PRICING: Record<string, { input: number; output: number }> = {
  "claude-opus-4": { input: 15.0, output: 75.0 }, "claude-sonnet-4-6": { input: 3.0, output: 15.0 },
  "claude-sonnet-4-5": { input: 3.0, output: 15.0 }, "claude-haiku-4-5": { input: 0.8, output: 4.0 },
  "claude-3-5-sonnet": { input: 3.0, output: 15.0 }, "claude-3-5-haiku": { input: 0.8, output: 4.0 },
  "claude-3-opus": { input: 15.0, output: 75.0 }, "claude-3-sonnet": { input: 3.0, output: 15.0 },
  "claude-3-haiku": { input: 0.25, output: 1.25 },
};
function getClaudeModelPrice(model: string) { const lower = model.toLowerCase(); for (const [key, price] of Object.entries(CLAUDE_PRICING)) { if (lower.includes(key)) return price; } return { input: 3.0, output: 15.0 }; }

router.get("/usage", async (req, res) => {
  try {
    const { oauth_key_id, period = "7" } = req.query as { oauth_key_id?: string; period?: string };
    if (!oauth_key_id) return res.status(400).json({ error: "oauth_key_id required" });
    const { apiKey } = await loadClaudeKey(oauth_key_id);
    const days = parseInt(period) || 7;
    const warnings: string[] = [];
    const headers = anthropicHeaders(apiKey);
    const startingAt = new Date((Math.floor(Date.now() / 1000) - days * 86400) * 1000).toISOString();
    const url = `${ANTHROPIC_BASE}/v1/organizations/usage_report/messages?starting_at=${encodeURIComponent(startingAt)}&bucket_width=1d&group_by[]=model&limit=31`;
    const r = await fetch(url, { headers });
    if (!r.ok) { const body = await r.json().catch(() => ({})) as any; warnings.push(`Usage API unavailable (HTTP ${r.status}): ${body?.error?.message || "Admin API key required"}`); return res.json({ vendor: "Claude / Anthropic", period: `P${days}D`, deployments: [], summary: { totalTokens: 0, totalRequests: 0, totalCost: 0 }, warnings }); }
    const data = await r.json() as any;
    const modelMap: Record<string, { inputTokens: number; outputTokens: number; bucketsWithActivity: number }> = {};
    for (const bucket of data.data || []) {
      for (const result of bucket.results || []) {
        const model = result.model || "claude-sonnet-4-6";
        const inputTokens = (result.uncached_input_tokens || 0) + (result.cache_creation_input_tokens || 0) + (result.cache_read_input_tokens || 0);
        const outputTokens = result.output_tokens || 0;
        if (!modelMap[model]) modelMap[model] = { inputTokens: 0, outputTokens: 0, bucketsWithActivity: 0 };
        modelMap[model].inputTokens += inputTokens;
        modelMap[model].outputTokens += outputTokens;
        if (inputTokens > 0 || outputTokens > 0) modelMap[model].bucketsWithActivity += 1;
      }
    }
    if (data.has_more) warnings.push("Usage report has more pages than fetched.");
    const deployments = Object.entries(modelMap).map(([model, stats]) => { const pricing = getClaudeModelPrice(model); const inputCost = (stats.inputTokens / 1_000_000) * pricing.input; const outputCost = (stats.outputTokens / 1_000_000) * pricing.output; return { deploymentName: model, modelName: model, inputTokens: stats.inputTokens, outputTokens: stats.outputTokens, totalTokens: stats.inputTokens + stats.outputTokens, requestCount: stats.bucketsWithActivity, inputCost, outputCost, totalCost: inputCost + outputCost }; });
    const summary = deployments.reduce((acc: any, d: any) => ({ totalTokens: acc.totalTokens + d.totalTokens, totalRequests: acc.totalRequests + d.requestCount, totalCost: acc.totalCost + d.totalCost }), { totalTokens: 0, totalRequests: 0, totalCost: 0 });
    res.json({ vendor: "Claude / Anthropic", period: `P${days}D`, deployments, summary, warnings });
  } catch (err: any) { res.status(err?.status || 500).json({ error: err.message || "Failed to fetch usage" }); }
});

router.delete("/project", async (req, res) => {
  try {
    const { oauth_key_id, project_id, org_id } = req.query as { oauth_key_id?: string; project_id?: string; org_id?: string };
    if (!oauth_key_id) return res.status(400).json({ error: "oauth_key_id required" });
    if (!project_id) return res.status(400).json({ error: "project_id required" });
    if (!org_id) return res.status(400).json({ error: "org_id required" });
    const { sessionKey: rawSessionKey } = await loadClaudeKey(oauth_key_id);
    if (!rawSessionKey) return res.status(400).json({ error: "No Claude.ai session key configured." });
    const sessionKey = rawSessionKey.startsWith("sessionKey=") ? rawSessionKey.slice("sessionKey=".length) : rawSessionKey;
    const deleteRes = await fetch(`${CLAUDE_AI_BASE}/api/organizations/${org_id}/projects/${project_id}`, { method: "DELETE", headers: claudeAIHeaders(sessionKey) });
    if (!deleteRes.ok) { const errBody = await deleteRes.json().catch(() => ({})) as any; if (deleteRes.status === 401 || deleteRes.status === 403) return res.status(403).json({ error: "Session key invalid or expired." }); if (deleteRes.status === 404) return res.status(404).json({ error: "Project not found." }); return res.status(deleteRes.status).json({ error: `Delete failed (HTTP ${deleteRes.status}): ${errBody?.error?.message || ""}` }); }
    return res.json({ deleted: true, project_id, org_id });
  } catch (err: any) { res.status(err?.status || 500).json({ error: err.message || "Delete failed" }); }
});

router.post("/workspace/archive", async (req, res) => {
  try {
    const { oauth_key_id, workspace_id } = req.body as { oauth_key_id?: string; workspace_id?: string };
    if (!oauth_key_id) return res.status(400).json({ error: "oauth_key_id required" });
    if (!workspace_id) return res.status(400).json({ error: "workspace_id required" });
    const { apiKey } = await loadClaudeKey(oauth_key_id);
    if (!apiKey.startsWith("sk-ant-admin")) return res.status(400).json({ error: "Admin API key required." });
    const headers = { ...anthropicHeaders(apiKey), "anthropic-beta": "workspaces-2025-01-13" };
    const archiveRes = await fetch(`${ANTHROPIC_BASE}/v1/organizations/workspaces/${workspace_id}/archive`, { method: "POST", headers });
    if (!archiveRes.ok) { const errBody = await archiveRes.json().catch(() => ({})) as any; return res.status(archiveRes.status).json({ error: `Archive failed (HTTP ${archiveRes.status}): ${errBody?.error?.message || ""}` }); }
    return res.json({ archived: true, workspace_id });
  } catch (err: any) { res.status(err?.status || 500).json({ error: err.message || "Archive failed" }); }
});

router.get("/files", async (req, res) => {
  try {
    const { oauth_key_id } = req.query as { oauth_key_id?: string };
    if (!oauth_key_id) return res.status(400).json({ error: "oauth_key_id required" });
    const { apiKey } = await loadClaudeKey(oauth_key_id);
    const headers = { ...anthropicHeaders(apiKey), "anthropic-beta": "files-api-2025-04-14" };
    const r = await fetch(`${ANTHROPIC_BASE}/v1/files?limit=100`, { headers });
    if (!r.ok) { const errBody = await r.json().catch(() => ({})) as any; if (r.status === 404 || r.status === 403) return res.json({ files: [], apiNotEnabled: true, warnings: ["The Anthropic Files API is not enabled for this account."] }); return res.json({ files: [], warnings: [`Files API error (HTTP ${r.status}): ${errBody?.error?.message || ""}`] }); }
    const data = await r.json() as any;
    const files = (data.data || []).map((f: any) => ({ id: f.id, filename: f.filename || f.id, size: f.size || 0, created_at: f.created_at, purpose: f.purpose || "assistants" }));
    return res.json({ files, total: files.length, warnings: [] });
  } catch (err: any) { res.status(err?.status || 500).json({ error: err.message || "Failed to fetch files" }); }
});

export default router;
