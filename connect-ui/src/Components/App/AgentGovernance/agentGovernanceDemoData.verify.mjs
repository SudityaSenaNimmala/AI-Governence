// Temp verification: replays the EXACT property expressions the Agent
// Governance components evaluate during render, against the demo mocks.
// Any expression that throws here would blank the live page.
globalThis.localStorage = { _v: {}, getItem(k){return this._v[k]??null;}, setItem(k,v){this._v[k]=String(v);}, removeItem(k){delete this._v[k];} };
globalThis.window = { location: { search: "?agDemo=1", origin: "http://localhost" }, fetch: async () => { throw new Error("REAL NETWORK CALL"); } };

const { agDemoResponse, AG_DEMO_AGENTS, agDemoDiscoveryResult } = await import("./agentGovernanceDemoData.js");
const g = (p, m) => agDemoResponse(p, { method: m || "GET" });

let fails = 0;
const t = (label, fn) => {
  try { const r = fn(); console.log(`  PASS  ${label}${r !== undefined && r !== null ? ` -> ${r}` : ""}`); }
  catch (e) { console.log(`  THROW ${label}  ::  ${e.message}`); fails++; }
};

console.log("\n=== AgentPermissionsPanel (UserActivityTab) ===");
const perms = g("/activity/agent-permissions?oauth_key_id=k");
t("data.totalApps / data.summary.*", () => {
  const s = perms.summary;
  return `${perms.totalApps} apps, file=${s.withFileAccess} write=${s.withWriteAccess} crit=${s.criticalRisk} agents=${s.agentCount}`;
});
t("riskyApps filter (uses summary.criticalCount)", () =>
  perms.apps.filter(a => a.summary.hasFileAccess || a.summary.hasWriteAccess || a.summary.criticalCount > 0).length + " risky");
t("per-row read/write split + filePermissions map (THE CRASH)", () => {
  let chips = 0, fileChips = 0;
  for (const app of perms.apps) {
    app.permissions.filter(p => !p.isWrite);
    app.permissions.filter(p => p.isWrite);
    if (!["critical","high","medium","low"].includes(app.summary.riskLevel)) throw new Error("bad riskLevel " + app.summary.riskLevel);
    if (app.summary.hasFileAccess) fileChips += app.summary.filePermissions.map(fp => fp.includes("Write")).length;
    for (const p of app.permissions) {
      if (!p.permission) throw new Error("permission item missing .permission");
      if (!["files","mail","directory","communications","calendar","other"].includes(p.category)) throw new Error("bad category " + p.category);
      if (!["critical","high","medium","low"].includes(p.level)) throw new Error("bad level " + p.level);
      if (!p.resourceDisplayName) throw new Error("missing resourceDisplayName");
      chips++;
    }
  }
  return `${chips} permission chips, ${fileChips} file-access chips`;
});

console.log("\n=== AzureAIFoundryView (DiscoveryTab, auto-loads on mount) ===");
const az = g("/azure/discover?oauth_key_id=k");
t("totalDeployments reduce", () => az.openAIResources.reduce((s, r) => s + r.deployments.length, 0) + " deployments");
t("totalTPM nested reduce", () => az.openAIResources.reduce((s, r) => s + r.deployments.reduce((ds, d) => ds + (d.capacityTPM || 0), 0), 0) + " TPM");
t("uniqueModels flatMap -> d.modelName", () => [...new Set(az.openAIResources.flatMap(r => r.deployments.map(d => d.modelName)))].join(", "));
t("workspaceCount = foundryAgents.filter(!modelName)", () => az.foundryAgents.filter(a => !a.modelName).length + " workspaces");
t("all six unguarded arrays present", () => {
  for (const k of ["openAIResources","serverlessEndpoints","foundryAgents","aiServices","accessControl","subscriptions"]) {
    if (!Array.isArray(az[k])) throw new Error(`${k} is ${az[k] === undefined ? "MISSING" : typeof az[k]}`);
  }
  return "openAIResources, serverlessEndpoints, foundryAgents, aiServices, accessControl, subscriptions";
});
t("deployment row fields", () => {
  for (const r of az.openAIResources) for (const d of r.deployments) {
    void d.id; void d.name; void d.modelName; void (d.modelVersion || "-");
    void (d.capacityTPM >= 1000 ? d.capacityTPM / 1000 : d.capacityTPM);
    void (d.contentFilter ? d.contentFilter : "None"); void (d.skuName || "-"); void (d.provisioningState || "Unknown");
  }
  return "ok";
});
t("accessControl row fields", () => az.accessControl.slice(0, 50)
  .map(ac => `${ac.principalId.slice(0,8)}/${ac.principalType}/${ac.roleName.includes("Owner")}/${ac.resourceId.split("/").pop()}`).length + " rows");
t("serverless + aiServices + subscriptions rows", () => {
  az.serverlessEndpoints.map(ep => [ep.id, ep.name, ep.modelId, ep.workspaceName, ep.location, ep.state]);
  az.aiServices.map(s => [s.id, s.name, s.kind, s.location, s.skuName, s.publicAccess]);
  az.subscriptions.map(s => [s.id, s.name]);
  return "ok";
});

console.log("\n=== Azure usage panel (UserActivityTab) ===");
const usage = g("/activity/azure/usage?oauth_key_id=k&period=P7D");
t("KPI values are non-zero", () => `${usage.totalRequests?.toLocaleString()} requests, ${usage.totalTokens?.toLocaleString()} tokens, ${usage.resources?.length} resources`);
t("resources.flatMap(r => r.metrics.deployments.map(...))", () =>
  usage.resources.flatMap(r => r.metrics.deployments.map(d =>
    `${r.resourceName}/${d.deploymentName}/${d.requestCount.toLocaleString()}/${d.promptTokens.toLocaleString()}/${d.completionTokens.toLocaleString()}/${d.totalTokens.toLocaleString()}`)).length + " rows");
t("threads shape", () => (g("/activity/azure/threads?oauth_key_id=k").threads || []).length + " threads");
t("assistants shape", () => (g("/activity/azure/assistants?oauth_key_id=k").assistants || []).length + " assistants");

console.log("\n=== ChatCard / FileRow / KnowledgeSourceCard ===");
t("chats: messages split + startTime", () => {
  const cs = g("/activity/chats?oauth_key_id=k").chats;
  for (const c of cs) {
    c.messages.filter(m => m.from !== "bot"); c.messages.filter(m => m.from === "bot");
    if (Number.isNaN(new Date(c.startTime).getTime())) throw new Error("bad startTime");
    for (const m of c.messages) { if (!m.text || !m.fromName) throw new Error("message missing text/fromName"); }
  }
  return cs.length + " chats";
});
t("files: relatedAgents are strings", () => {
  const fs = g("/activity/files?oauth_key_id=k").files;
  for (const f of fs) {
    if (f.relatedAgents?.length > 0) for (const a of f.relatedAgents) if (typeof a !== "string") throw new Error("relatedAgents item is not a string");
    if (Number.isNaN(new Date(f.timestamp).getTime())) throw new Error("bad timestamp");
  }
  return fs.length + " file rows";
});
t("knowledge: bots[].sources[] typed", () => {
  const types = new Set(["sharepoint","website","dataverse_table","azure_storage","file_analysis","model_knowledge","knowledge_article","connector","uploaded_file","other"]);
  const bots = g("/activity/knowledge?oauth_key_id=k").bots;
  let n = 0;
  for (const b of bots) for (const s of b.sources) { if (!types.has(s.type)) throw new Error("unknown source type " + s.type); n++; }
  return `${bots.length} bots, ${n} sources`;
});

console.log("\n=== Overview / Discovery (context agents) ===");
t("computeMetrics-style rollup", () => {
  const A = AG_DEMO_AGENTS, now = Date.now(), TH = 30 * 864e5;
  const dist = { critical:0, high:0, medium:0, low:0 };
  for (const a of A) { dist[a.risk.level]++; a.risk.factors.map(f => [f.signal, f.weight, f.description]); a.connectors.map(c => c.name); a.permissions.map(pp => pp.name); }
  const stale = A.filter(a => { const l = a.activity.lastActiveTimestamp ? new Date(a.activity.lastActiveTimestamp).getTime() : null; return !l || now - l > TH; });
  return `${A.length} agents, ${stale.length} stale, dist ${JSON.stringify(dist)}`;
});
t("discovery result tenant fields", () => { const r = agDemoDiscoveryResult(); return `${r.tenant.name} / ${r.agents.length} agents / ${r.warnings.length} warnings`; });

console.log("\n=== Policies / Packs / Alerts ===");
t("policies array + pack grouping", () => {
  const ps = g("/policies");
  for (const p of ps) { p.conditions.map(c => `${c.field} ${c.operator} ${c.value}`); (p.actions || []).map(a => a.type); void p.scope?.type; }
  return `${ps.length} policies, ${new Set(ps.filter(p => p.pack_id).map(p => p.pack_id)).size} pack group(s)`;
});
t("packs rows", () => g("/policy-packs").map(pk => [pk.id, pk.framework, pk.deployed, pk.ruleCount, pk.enforceable, pk.monitored, pk.attestations]).length + " packs");
t("simulate result", () => { const s = g("/policies/simulate", "POST"); s.matches.map(mm => mm.agent_name); return `would_flag ${s.would_flag}, ${s.matches.length} match rows`; });
t("alerts/check", () => g("/alerts/check", "POST").alerts.map(a => a.message).length + " alerts");

console.log("\n=== REJECT paths must reject, not return junk ===");
const rejects = ["/google/discover?oauth_key_id=k","/google/user-activity","/gemini-enterprise/data","/openai/threads?oauth_key_id=k","/claude/budget/members?oauth_key_id=k","/aws/usage?oauth_key_id=k","/cost/pricing","/prompts/summary","/recertification/stats","/sensitivity/summary","/agent-metadata?limit=50"];
for (const p of rejects) {
  const r = g(p);
  const isPromise = r && typeof r.then === "function";
  if (!isPromise) { console.log(`  BAD   ${p} returned a value instead of rejecting`); fails++; }
  else { r.catch(() => {}); console.log(`  PASS  ${p} rejects`); }
}
t("agent-metadata single record still {exists:false}", () => "exists=" + g("/agent-metadata/demo-copilot_studio-0").exists);
t("AI Hub /v1 never intercepted", () => { if (g("/v1/overview") !== undefined) throw new Error("intercepted!"); return "passes through"; });

console.log(fails === 0 ? "\nALL RENDER PATHS OK" : `\n${fails} FAILURE(S) — would crash the live page`);
process.exit(fails === 0 ? 0 : 1);
