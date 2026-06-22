import { Router } from "express";
import { getDb } from "../db.js";
import { encrypt, decrypt } from "../crypto.js";
import crypto from "node:crypto";

const router = Router();

function openAIHeaders(apiKey: string, orgId?: string | null) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "OpenAI-Beta": "assistants=v2",
  };
  if (orgId) headers["OpenAI-Organization"] = orgId;
  return headers;
}

async function loadOpenAIKey(oauthKeyId: string) {
  const db = getDb();
  const row = await db.collection("oauth_keys").findOne({ id: oauthKeyId, vendor: "openai" });
  if (!row) {
    const e: any = new Error("OpenAI credentials not found");
    e.status = 404;
    throw e;
  }
  const rawClientId = row.client_id || "";
  const isAdminKeyStored = rawClientId.startsWith("sk-") || rawClientId.length > 20;
  return {
    apiKey: decrypt(row.client_secret),
    adminKey: isAdminKeyStored ? decrypt(rawClientId) : null,
    orgId: row.tenant_id || undefined,
    sessionToken: row.redirect_uri ? decrypt(row.redirect_uri) : null,
  };
}

function buildSessionCookie(stored: string): string {
  if (stored.includes("||")) {
    const [t0, t1] = stored.split("||");
    return `__Secure-next-auth.session-token.0=${t0}; __Secure-next-auth.session-token.1=${t1}`;
  }
  return `__Secure-next-auth.session-token=${stored}`;
}

async function getAccessToken(sessionToken: string): Promise<{ token: string | null; error: string | null }> {
  try {
    const cookieStr = buildSessionCookie(sessionToken);
    const res = await fetch("https://chatgpt.com/api/auth/session", {
      headers: {
        Cookie: cookieStr,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "application/json",
        "Accept-Language": "en-US,en;q=0.9",
        Referer: "https://chatgpt.com/",
        Origin: "https://chatgpt.com",
      },
    });
    if (!res.ok) return { token: null, error: `Auth session HTTP ${res.status} ${res.statusText}` };
    const data = await res.json() as any;
    if (!data?.accessToken) {
      const keys = Object.keys(data || {}).join(", ") || "empty response";
      return { token: null, error: `No accessToken in response (keys: ${keys})` };
    }
    return { token: data.accessToken, error: null };
  } catch (err: any) {
    return { token: null, error: `Auth request failed: ${err.message}` };
  }
}

// POST /api/openai/connect
router.post("/connect", async (req, res) => {
  try {
    const { api_key, admin_key, org_id, session_token } = req.body as {
      api_key?: string; admin_key?: string; org_id?: string; session_token?: string;
    };
    if (!api_key?.trim()) return res.status(400).json({ error: "OpenAI API key is required" });

    const db = getDb();

    if (api_key.trim() === "__USE_EXISTING__") {
      const existing = await db.collection("oauth_keys").findOne({ vendor: "openai" });
      if (!existing) return res.status(404).json({ error: "No saved OpenAI credentials found" });
      const updates: Record<string, any> = { updated_at: new Date() };
      if (org_id?.trim()) updates.tenant_id = org_id.trim();
      if (session_token?.trim()) updates.redirect_uri = encrypt(session_token.trim());
      if (admin_key?.trim()) updates.client_id = encrypt(admin_key.trim());
      if (Object.keys(updates).length > 1) {
        await db.collection("oauth_keys").updateOne({ id: existing.id }, { $set: updates });
      }
      return res.json({ id: existing.id, vendor: "openai", connected: true });
    }

    const trimmedKey = api_key.trim();
    const hdrs = openAIHeaders(trimmedKey, org_id?.trim());

    const modelsRes = await fetch("https://api.openai.com/v1/models", { headers: hdrs });
    if (!modelsRes.ok) {
      const e = await modelsRes.json().catch(() => ({})) as any;
      return res.status(400).json({ error: `Invalid API key: ${e?.error?.message || modelsRes.statusText}` });
    }

    if (admin_key?.trim()) {
      const adminHdrs = openAIHeaders(admin_key.trim(), org_id?.trim());
      const adminRes = await fetch("https://api.openai.com/v1/organization/projects?limit=1", { headers: adminHdrs });
      if (!adminRes.ok && (adminRes.status === 401 || adminRes.status === 403)) {
        const e = await adminRes.json().catch(() => ({})) as any;
        return res.status(400).json({ error: `Invalid Admin key: ${e?.error?.message || adminRes.statusText}` });
      }
    }

    const encryptedKey = encrypt(trimmedKey);
    const encryptedAdmin = admin_key?.trim() ? encrypt(admin_key.trim()) : null;
    const encryptedSession = session_token?.trim() ? encrypt(session_token.trim()) : null;
    const existing = await db.collection("oauth_keys").findOne({ vendor: "openai" });

    let id: string;
    if (existing) {
      id = existing.id;
      const updates: Record<string, any> = { client_secret: encryptedKey, tenant_id: org_id?.trim() || null, updated_at: new Date() };
      if (encryptedAdmin) updates.client_id = encryptedAdmin;
      if (encryptedSession) updates.redirect_uri = encryptedSession;
      await db.collection("oauth_keys").updateOne({ id }, { $set: updates });
    } else {
      id = crypto.randomUUID();
      await db.collection("oauth_keys").insertOne({
        id,
        vendor: "openai",
        client_id: encryptedAdmin || "openai-key",
        client_secret: encryptedKey,
        tenant_id: org_id?.trim() || null,
        redirect_uri: encryptedSession,
        created_at: new Date(),
        updated_at: new Date(),
      });
    }

    res.json({ id, vendor: "openai", connected: true, hasAdminKey: !!encryptedAdmin });
  } catch (err: any) {
    res.status(err?.status || 500).json({ error: err.message || "Failed to connect OpenAI" });
  }
});

// The rest of the file (scan-platform, usage, activity, knowledge, threads, files, gpt delete) has NO DB calls
// — it only calls loadOpenAIKey which is already converted above. Copy the rest unchanged.

// GET /api/openai/scan-platform?oauth_key_id=X&platform=Y
router.get("/scan-platform", async (req, res) => {
  try {
    const { oauth_key_id, platform } = req.query as { oauth_key_id?: string; platform?: string };
    if (!oauth_key_id) return res.status(400).json({ error: "oauth_key_id required" });
    if (!platform) return res.status(400).json({ error: "platform required" });

    const { apiKey, adminKey, orgId, sessionToken } = await loadOpenAIKey(oauth_key_id);
    const headers = openAIHeaders(apiKey, orgId);
    const adminHeaders = openAIHeaders(adminKey || apiKey, orgId);

    if (platform === "assistants") {
      const assistants: any[] = [];
      let after: string | undefined;
      let hasMore = true;
      while (hasMore) {
        const url = new URL("https://api.openai.com/v1/assistants");
        url.searchParams.set("limit", "100");
        url.searchParams.set("order", "desc");
        if (after) url.searchParams.set("after", after);
        const r = await fetch(url.toString(), { headers });
        if (!r.ok) {
          const e = await r.json().catch(() => ({})) as any;
          throw new Error(e?.error?.message || `Assistants API error: ${r.status}`);
        }
        const data = await r.json() as any;
        assistants.push(...(data.data || []));
        hasMore = data.has_more;
        after = data.last_id;
        if (!after) break;
      }
      await Promise.allSettled(assistants.map(async (asst) => {
        const vsIds: string[] = asst.tool_resources?.file_search?.vector_store_ids || [];
        if (!vsIds.length) return;
        let totalFiles = 0;
        await Promise.allSettled(vsIds.map(async (vsId) => {
          try {
            const vsr = await fetch(`https://api.openai.com/v1/vector_stores/${vsId}/files?limit=100`, { headers });
            if (vsr.ok) {
              const vsd = await vsr.json() as any;
              totalFiles += (vsd.data || []).length;
            }
          } catch {}
        }));
        asst._fileCount = totalFiles;
        asst._vectorStoreIds = vsIds;
      }));
      return res.json({ platform: "assistants", assistants, warnings: [] });
    }

    if (platform === "my_gpts") {
      if (!sessionToken) {
        return res.json({ platform: "my_gpts", gpts: [], warnings: ["ChatGPT session token not configured. Add it in the ChatGPT connection settings to discover Custom GPTs."] });
      }
      const { token: accessToken, error: authError } = await getAccessToken(sessionToken);
      if (!accessToken) {
        return res.json({ platform: "my_gpts", gpts: [], warnings: [`Session auth failed: ${authError}. Please refresh your ChatGPT session token.`] });
      }
      const gptHeaders: Record<string, string> = {
        Authorization: `Bearer ${accessToken}`,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "application/json", "Content-Type": "application/json",
        Referer: "https://chatgpt.com/", Origin: "https://chatgpt.com",
      };
      const allGpts: any[] = [];
      const seenIds = new Set<string>();
      const warnings: string[] = [];
      const candidateEndpoints = [
        { url: "https://chatgpt.com/backend-api/gizmos/mine?offset=0&limit=50", label: "gizmos/mine" },
        { url: "https://chatgpt.com/backend-api/gpts?owned_by=me&limit=50&offset=0", label: "gpts?owned_by=me" },
        { url: "https://chatgpt.com/backend-api/gpts/mine?offset=0&limit=50", label: "gpts/mine" },
        { url: "https://chatgpt.com/backend-api/me/gpts?offset=0&limit=50", label: "me/gpts" },
        { url: "https://chatgpt.com/backend-api/gizmos?owned_by=me&limit=50&offset=0", label: "gizmos?owned_by=me" },
      ];
      let foundEndpoint = false;
      for (const candidate of candidateEndpoints) {
        try {
          const r = await fetch(candidate.url, { headers: gptHeaders });
          if (!r.ok) continue;
          const data = await r.json() as any;
          let items: any[] = [];
          if (Array.isArray(data.cuts)) {
            for (const cut of data.cuts) { items.push(...(cut.items || cut.gizmos || cut.list?.items || [])); }
          } else { items = data.items || data.gpts || data.gizmos || data.data || data.results || []; }
          foundEndpoint = true;
          for (const g of items) {
            const gizmo = g.resource?.gizmo || g.gizmo || g;
            const id = gizmo.id || gizmo.gizmo_id || g.id || g.slug;
            if (id && !seenIds.has(id)) { seenIds.add(id); allGpts.push({ ...gizmo, _source: "personal" }); }
          }
          break;
        } catch {}
      }
      if (!foundEndpoint && allGpts.length === 0) warnings.push("Could not find a working GPTs endpoint.");
      return res.json({ platform: "my_gpts", gpts: allGpts, warnings });
    }

    if (platform === "vector_stores") {
      const r = await fetch("https://api.openai.com/v1/vector_stores?limit=100", { headers });
      if (!r.ok) return res.json({ platform: "vector_stores", vectorStores: [], warnings: [`Vector stores unavailable: ${r.status}`] });
      const data = await r.json() as any;
      return res.json({ platform: "vector_stores", vectorStores: data.data || [], warnings: [] });
    }

    if (platform === "api_keys") {
      const warnings: string[] = [];
      const apiKeys: any[] = [];
      const seenIds = new Set<string>();
      if (!adminKey) return res.json({ platform: "api_keys", apiKeys: [], warnings: ["No Admin key configured."] });
      const projRes = await fetch("https://api.openai.com/v1/organization/projects?limit=100", { headers: adminHeaders });
      if (!projRes.ok) {
        const e = await projRes.json().catch(() => ({})) as any;
        warnings.push(projRes.status === 403 || projRes.status === 401
          ? "The Organization API requires a Service Account key (sk-svcacct-...)."
          : `Organization Projects API error (HTTP ${projRes.status}): ${e?.error?.message || ""}`);
        return res.json({ platform: "api_keys", apiKeys, warnings });
      }
      const projData = await projRes.json() as any;
      const projects: any[] = projData.data || [];
      await Promise.allSettled(projects.map(async (proj: any) => {
        try {
          let after: string | null = null; let page = 0;
          do {
            const url = new URL(`https://api.openai.com/v1/organization/projects/${proj.id}/api_keys`);
            url.searchParams.set("limit", "100");
            if (after) url.searchParams.set("after", after);
            const r = await fetch(url.toString(), { headers: adminHeaders });
            if (!r.ok) break;
            const data = await r.json() as any;
            for (const k of (data.data || [])) {
              if (seenIds.has(k.id)) continue;
              seenIds.add(k.id);
              apiKeys.push({ id: k.id, name: k.name || `API Key ${k.id}`, project_id: proj.id, project_name: proj.name || "Default Project", created_at: k.created_at, last_used_at: k.last_used_at || null, created_by: k.owner?.user?.email || k.owner?.service_account?.name || null, status: "active" });
            }
            after = data.has_more ? (data.last_id || null) : null; page++;
          } while (after && page < 10);
        } catch {}
      }));
      if (apiKeys.length === 0 && warnings.length === 0) warnings.push("No API keys found across all projects.");
      return res.json({ platform: "api_keys", apiKeys, warnings });
    }

    return res.status(400).json({ error: `Unknown platform: ${platform}` });
  } catch (err: any) {
    res.status(err?.status || 500).json({ error: err.message || "Scan failed" });
  }
});

const OPENAI_PRICING: Record<string, { input: number; output: number }> = {
  "gpt-4o": { input: 2.5, output: 10 }, "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "gpt-4-turbo": { input: 10, output: 30 }, "gpt-4": { input: 30, output: 60 },
  "gpt-3.5-turbo": { input: 0.5, output: 1.5 }, "gpt-35-turbo": { input: 0.5, output: 1.5 },
  "o1": { input: 15, output: 60 }, "o1-mini": { input: 3, output: 12 },
  "o3-mini": { input: 1.1, output: 4.4 }, "o3": { input: 10, output: 40 },
};
function getModelPrice(model: string) {
  const lower = model.toLowerCase();
  for (const [key, price] of Object.entries(OPENAI_PRICING)) { if (lower.includes(key)) return price; }
  return { input: 2.5, output: 10 };
}

router.get("/usage", async (req, res) => {
  try {
    const { oauth_key_id, period = "7" } = req.query as { oauth_key_id?: string; period?: string };
    if (!oauth_key_id) return res.status(400).json({ error: "oauth_key_id required" });
    const { apiKey, adminKey, orgId } = await loadOpenAIKey(oauth_key_id);
    const orgKey = adminKey || apiKey;
    const headers = openAIHeaders(orgKey, orgId);
    const days = parseInt(period) || 7;
    const endTime = Math.floor(Date.now() / 1000);
    const startTime = endTime - days * 86400;
    const warnings: string[] = [];
    if (!adminKey) warnings.push("No admin/org API key stored — usage data requires an Organization Admin key.");
    const modelMap: Record<string, { inputTokens: number; outputTokens: number; requestCount: number }> = {};
    const bucketLimit = Math.min(Math.max(days + 1, 1), 31);
    const url = `https://api.openai.com/v1/organization/usage/completions?start_time=${startTime}&end_time=${endTime}&bucket_width=1d&group_by[]=model&limit=${bucketLimit}`;
    const r = await fetch(url, { headers });
    if (!r.ok) {
      const e = await r.json().catch(() => ({})) as any;
      warnings.push(`Usage API unavailable (HTTP ${r.status}): ${e?.error?.message || "admin/org-level API key required"}`);
    } else {
      const data = await r.json() as any;
      for (const bucket of data.data || []) {
        for (const result of bucket.results || []) {
          const model = result.model || "unknown";
          if (!modelMap[model]) modelMap[model] = { inputTokens: 0, outputTokens: 0, requestCount: 0 };
          modelMap[model].inputTokens += result.input_tokens || 0;
          modelMap[model].outputTokens += result.output_tokens || 0;
          modelMap[model].requestCount += result.num_model_requests || 0;
        }
      }
    }
    const deployments = Object.entries(modelMap).map(([model, stats]) => {
      const pricing = getModelPrice(model);
      const inputCost = (stats.inputTokens / 1_000_000) * pricing.input;
      const outputCost = (stats.outputTokens / 1_000_000) * pricing.output;
      return { deploymentName: model, modelName: model, inputTokens: stats.inputTokens, outputTokens: stats.outputTokens, totalTokens: stats.inputTokens + stats.outputTokens, requestCount: stats.requestCount, inputCost, outputCost, totalCost: inputCost + outputCost };
    });
    const summary = deployments.reduce((acc, d) => ({ totalTokens: acc.totalTokens + d.totalTokens, totalRequests: acc.totalRequests + d.requestCount, totalCost: acc.totalCost + d.totalCost }), { totalTokens: 0, totalRequests: 0, totalCost: 0 });
    res.json({ vendor: "OpenAI", period: `P${days}D`, deployments, summary, warnings });
  } catch (err: any) { res.status(err?.status || 500).json({ error: err.message || "Failed to fetch usage" }); }
});

router.get("/activity", async (req, res) => {
  try {
    const { oauth_key_id, period = "30" } = req.query as { oauth_key_id?: string; period?: string };
    if (!oauth_key_id) return res.status(400).json({ error: "oauth_key_id required" });
    const { apiKey, adminKey, orgId } = await loadOpenAIKey(oauth_key_id);
    const orgKey = adminKey || apiKey;
    const headers = openAIHeaders(orgKey, orgId);
    const days = parseInt(period) || 30;
    const endTime = Math.floor(Date.now() / 1000);
    const startTime = endTime - days * 86400;
    const warnings: string[] = [];
    if (!adminKey) warnings.push("No admin/org API key stored — per-user activity requires an Organization Admin key.");
    const userMap: Record<string, { userId: string; inputTokens: number; outputTokens: number; requestCount: number }> = {};
    let lastActiveTimestamp: string | null = null;
    const bucketLimit = Math.min(Math.max(days + 1, 1), 31);
    const url = `https://api.openai.com/v1/organization/usage/completions?start_time=${startTime}&end_time=${endTime}&bucket_width=1d&group_by[]=user_id&limit=${bucketLimit}`;
    const r = await fetch(url, { headers });
    if (!r.ok) {
      const e = await r.json().catch(() => ({})) as any;
      warnings.push(`Activity API unavailable (HTTP ${r.status}): ${e?.error?.message || "admin/org-level API key required"}`);
    } else {
      const data = await r.json() as any;
      for (const bucket of data.data || []) {
        if (bucket.results?.some((result: any) => result.num_model_requests > 0)) lastActiveTimestamp = new Date(bucket.end_time * 1000).toISOString();
        for (const result of bucket.results || []) {
          const userId = result.user_id || "api-key";
          if (!userMap[userId]) userMap[userId] = { userId, inputTokens: 0, outputTokens: 0, requestCount: 0 };
          userMap[userId].inputTokens += result.input_tokens || 0;
          userMap[userId].outputTokens += result.output_tokens || 0;
          userMap[userId].requestCount += result.num_model_requests || 0;
        }
      }
    }
    const users = Object.values(userMap).sort((a, b) => b.requestCount - a.requestCount);
    res.json({ vendor: "OpenAI", period: `P${days}D`, users, totalUsers: users.length, lastActiveTimestamp, warnings });
  } catch (err: any) { res.status(err?.status || 500).json({ error: err.message || "Failed to fetch activity" }); }
});

router.get("/knowledge", async (req, res) => {
  try {
    const { oauth_key_id, assistant_id } = req.query as { oauth_key_id?: string; assistant_id?: string };
    if (!oauth_key_id) return res.status(400).json({ error: "oauth_key_id required" });
    if (!assistant_id) return res.status(400).json({ error: "assistant_id required" });
    const { apiKey, orgId } = await loadOpenAIKey(oauth_key_id);
    const headers = openAIHeaders(apiKey, orgId);
    const asstR = await fetch(`https://api.openai.com/v1/assistants/${assistant_id}`, { headers });
    if (!asstR.ok) return res.status(404).json({ error: "Assistant not found" });
    const asst = await asstR.json() as any;
    const vsIds: string[] = asst.tool_resources?.file_search?.vector_store_ids || [];
    const knowledgeFiles: any[] = [];
    const warnings: string[] = [];
    for (const vsId of vsIds) {
      try {
        const vsR = await fetch(`https://api.openai.com/v1/vector_stores/${vsId}/files?limit=100`, { headers });
        if (!vsR.ok) { warnings.push(`Vector store ${vsId}: HTTP ${vsR.status}`); continue; }
        const vsData = await vsR.json() as any;
        for (const vsFile of vsData.data || []) {
          try {
            const fileR = await fetch(`https://api.openai.com/v1/files/${vsFile.id}`, { headers });
            if (fileR.ok) {
              const fd = await fileR.json() as any;
              knowledgeFiles.push({ id: fd.id, filename: fd.filename, bytes: fd.bytes, purpose: fd.purpose, created_at: fd.created_at, vector_store_id: vsId, status: vsFile.status });
            } else { knowledgeFiles.push({ id: vsFile.id, filename: vsFile.id, bytes: 0, status: vsFile.status, vector_store_id: vsId }); }
          } catch {}
        }
      } catch (e: any) { warnings.push(`Vector store ${vsId}: ${e.message}`); }
    }
    res.json({ assistant_id, vectorStoreIds: vsIds, files: knowledgeFiles, totalFiles: knowledgeFiles.length, warnings });
  } catch (err: any) { res.status(err?.status || 500).json({ error: err.message || "Failed to fetch knowledge" }); }
});

router.get("/threads", async (req, res) => {
  try {
    const { oauth_key_id, limit = "50" } = req.query as { oauth_key_id?: string; limit?: string };
    if (!oauth_key_id) return res.status(400).json({ error: "oauth_key_id required" });
    const { apiKey, orgId } = await loadOpenAIKey(oauth_key_id);
    const headers = openAIHeaders(apiKey, orgId);
    const maxThreads = Math.min(parseInt(limit as string) || 50, 200);
    const threadsRes = await fetch(`https://api.openai.com/v1/threads?limit=${maxThreads}&order=desc`, { headers });
    if (!threadsRes.ok) {
      const e = await threadsRes.json().catch(() => ({})) as any;
      return res.json({ chats: [], warnings: [`Threads API: ${e?.error?.message || `HTTP ${threadsRes.status}`}`] });
    }
    const threadsData = await threadsRes.json() as any;
    const threads: any[] = threadsData.data || [];
    const BATCH = 10;
    const chats: any[] = [];
    for (let i = 0; i < threads.length; i += BATCH) {
      const batch = threads.slice(i, i + BATCH);
      const results = await Promise.allSettled(batch.map(async (thread: any) => {
        const msgsRes = await fetch(`https://api.openai.com/v1/threads/${thread.id}/messages?limit=100&order=asc`, { headers });
        if (!msgsRes.ok) return null;
        const msgsData = await msgsRes.json() as any;
        const messages = (msgsData.data || []).map((msg: any) => ({ from: msg.role === "user" ? "user" : "bot", text: (msg.content || []).filter((c: any) => c.type === "text").map((c: any) => c.text?.value || "").join(" ").trim(), timestamp: new Date(msg.created_at * 1000).toISOString() })).filter((m: any) => m.text);
        return { id: thread.id, botName: thread.metadata?.assistant_name || "OpenAI Assistant", userName: thread.metadata?.user_name || thread.metadata?.email || "API User", userId: thread.metadata?.user_id || thread.id, startTime: new Date(thread.created_at * 1000).toISOString(), messageCount: messages.length, messages, source: "openai_threads" };
      }));
      for (const r of results) { if (r.status === "fulfilled" && r.value) chats.push(r.value); }
    }
    res.json({ chats, total: chats.length, warnings: [] });
  } catch (err: any) { res.status(err?.status || 500).json({ error: err.message || "Failed to fetch threads" }); }
});

router.get("/files", async (req, res) => {
  try {
    const { oauth_key_id } = req.query as { oauth_key_id?: string };
    if (!oauth_key_id) return res.status(400).json({ error: "oauth_key_id required" });
    const { apiKey, orgId } = await loadOpenAIKey(oauth_key_id);
    const activeHeaders = openAIHeaders(apiKey, orgId);
    const probeRes = await fetch("https://api.openai.com/v1/files?limit=1", { headers: activeHeaders });
    if (!probeRes.ok) {
      const e = await probeRes.json().catch(() => ({})) as any;
      const errMsg = e?.error?.message || "";
      const isAdminKey = probeRes.status === 401 && (errMsg.includes("secret key") || errMsg.includes("api.files.read"));
      if (isAdminKey) return res.json({ files: [], warnings: [], insufficientScope: true });
      return res.json({ files: [], warnings: [`Files API error (HTTP ${probeRes.status}): ${errMsg}`] });
    }
    const files: any[] = [];
    const warnings: string[] = [];
    let after: string | null = null; let page = 0;
    do {
      const url = new URL("https://api.openai.com/v1/files");
      url.searchParams.set("limit", "100"); url.searchParams.set("order", "desc");
      if (after) url.searchParams.set("after", after);
      const r = await fetch(url.toString(), { headers: activeHeaders });
      if (!r.ok) { const e = await r.json().catch(() => ({})) as any; warnings.push(`Files API error (HTTP ${r.status}): ${e?.error?.message || "unknown"}`); break; }
      const data = await r.json() as any;
      for (const f of (data.data || [])) { files.push({ id: f.id, filename: f.filename, bytes: f.bytes || 0, size: f.bytes || 0, created_at: f.created_at, purpose: f.purpose, status: f.status || "processed" }); }
      after = data.has_more ? (data.last_id || null) : null; page++;
    } while (after && page < 20);
    res.json({ files, total: files.length, warnings });
  } catch (err: any) { res.status(err?.status || 500).json({ error: err.message || "Failed to fetch files" }); }
});

router.delete("/gpt", async (req, res) => {
  try {
    const { oauth_key_id, gpt_id } = req.query as { oauth_key_id?: string; gpt_id?: string };
    if (!oauth_key_id) return res.status(400).json({ error: "oauth_key_id required" });
    if (!gpt_id) return res.status(400).json({ error: "gpt_id required" });
    const { sessionToken } = await loadOpenAIKey(oauth_key_id);
    if (!sessionToken) return res.status(400).json({ error: "ChatGPT session token not configured." });
    const { token: accessToken, error: authError } = await getAccessToken(sessionToken);
    if (!accessToken) return res.status(401).json({ error: `Session auth failed: ${authError}.` });
    const headers: Record<string, string> = { Authorization: `Bearer ${accessToken}`, "User-Agent": "Mozilla/5.0", Accept: "application/json", "Content-Type": "application/json", Referer: "https://chatgpt.com/", Origin: "https://chatgpt.com" };
    const candidateUrls = [`https://chatgpt.com/backend-api/gizmos/${gpt_id}`, `https://chatgpt.com/backend-api/gpts/${gpt_id}`];
    let lastStatus = 0; let lastErr = "";
    for (const url of candidateUrls) {
      try {
        const r = await fetch(url, { method: "DELETE", headers });
        if (r.ok) return res.json({ deleted: true, gpt_id, endpoint: url });
        lastStatus = r.status;
        const errBody = await r.json().catch(() => ({})) as any;
        lastErr = errBody?.detail || errBody?.error?.message || r.statusText;
        if (r.status === 401 || r.status === 403) break;
      } catch (e: any) { lastErr = e.message; }
    }
    if (lastStatus === 401 || lastStatus === 403) return res.status(403).json({ error: "Session token is invalid or expired." });
    if (lastStatus === 404) return res.status(404).json({ error: "GPT not found." });
    return res.status(lastStatus || 500).json({ error: `GPT delete failed (HTTP ${lastStatus}): ${lastErr}` });
  } catch (err: any) { res.status(err?.status || 500).json({ error: err.message || "GPT delete failed" }); }
});

export default router;
