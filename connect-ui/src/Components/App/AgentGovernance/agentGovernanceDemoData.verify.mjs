// Replays the EXACT property expressions the Agent Governance components
// evaluate during render, against the demo dataset. Anything that throws here
// would blank the live page, because AgentGovernance.jsx mounts all six tabs at
// once and toggles display — one throw takes the whole screen.
//
// Run: node src/Components/App/AgentGovernance/agentGovernanceDemoData.verify.mjs
globalThis.localStorage = { _v: {}, getItem(k){return this._v[k]??null;}, setItem(k,v){this._v[k]=String(v);}, removeItem(k){delete this._v[k];} };
globalThis.window = { location: { search: "?agDemo=1", origin: "http://localhost" }, fetch: async () => { throw new Error("REAL NETWORK CALL"); } };

const { agDemoResponse, AG_DEMO_AGENTS, agDemoDiscoveryResult, AG_DEMO_KEYS } =
  await import("./agentGovernanceDemoData.js");
const g = (p, m, body) => agDemoResponse(p, { method: m || "GET", body });
const rejects = (r) => r && typeof r.then === "function";

let fails = 0;
const t = (label, fn) => {
  try { const r = fn(); console.log(`  PASS  ${label}${r !== undefined && r !== null ? ` -> ${r}` : ""}`); }
  catch (e) { console.log(`  THROW ${label}  ::  ${e.message}`); fails++; }
};

console.log("\n=== GOOGLE ONLY — no Microsoft surface at all ===");
t("no Microsoft / OpenAI / Claude / AWS agents", () => {
  const vendors = [...new Set(AG_DEMO_AGENTS.map(a => a.vendor))];
  if (vendors.length !== 1 || vendors[0] !== "Google") throw new Error("vendors present: " + vendors.join(", "));
  const bad = AG_DEMO_AGENTS.map(a => a.platform).filter(p =>
    /copilot|personal_agent|teams|sharepoint|isv|azure|oauth_app|openai|claude|aws|bedrock|sagemaker/.test(p));
  if (bad.length) throw new Error("non-Google platform(s): " + [...new Set(bad)].join(", "));
  const plats = [...new Set(AG_DEMO_AGENTS.map(a => a.platform))];
  return `${AG_DEMO_AGENTS.length} agents, all Google, across ${plats.length} platforms`;
});
t("Microsoft credentials are null so its UI never mounts", () => {
  for (const k of ["oauthKeyId", "tenantId", "dataverseEnvUrl", "azureSubscriptionId", "openaiKeyId", "claudeKeyId", "awsKeyId"]) {
    if (AG_DEMO_KEYS[k] !== null) throw new Error(`${k} is set — that would bring a non-Google surface back`);
  }
  if (!AG_DEMO_KEYS.googleKeyId || !AG_DEMO_KEYS.geminiEnterpriseKeyId) throw new Error("Google keys must be set");
  return "google + gemini_enterprise only";
});
t("Microsoft endpoints reject rather than serve a shape", () => {
  for (const p of ["/azure/discover?oauth_key_id=k", "/activity/azure/usage?period=P7D",
                   "/activity/azure/threads", "/activity/agent-permissions?oauth_key_id=k",
                   "/activity/chats?oauth_key_id=k", "/activity/files?oauth_key_id=k",
                   "/activity/knowledge?oauth_key_id=k", "/cost/azure?period=P7D"]) {
    if (!rejects(g(p))) throw new Error(p + " returned data — a Microsoft panel could render from it");
  }
  return "azure, graph activity, permissions and azure cost all reject";
});

console.log("\n=== Discovery (context agents) ===");
t("computeMetrics-style rollup", () => {
  const A = AG_DEMO_AGENTS, now = Date.now(), TH = 30 * 864e5;
  const dist = { critical:0, high:0, medium:0, low:0 };
  for (const a of A) {
    dist[a.risk.level]++;
    a.risk.factors.map(f => [f.signal, f.weight, f.description]);
    a.connectors.map(c => [c.name, c.type]);
    a.permissions.map(pp => pp.name);
  }
  const stale = A.filter(a => { const l = a.activity.lastActiveTimestamp ? new Date(a.activity.lastActiveTimestamp).getTime() : null; return !l || now - l > TH; });
  const orph = A.filter(a => a.isOrphaned);
  return `${A.length} agents, ${stale.length} stale, ${orph.length} orphaned, dist ${JSON.stringify(dist)}`;
});
t("tenant reads as a Workspace domain, not onmicrosoft.com", () => {
  const r = agDemoDiscoveryResult();
  if (/onmicrosoft/i.test(r.tenant.domain)) throw new Error("tenant domain still Microsoft: " + r.tenant.domain);
  if (!/Google/i.test(r.tenant.license)) throw new Error("licence does not read as Google: " + r.tenant.license);
  return `${r.tenant.name} / ${r.tenant.domain} / ${r.tenant.license}`;
});
// AGENTS ONLY. Gemini inside Gmail / Docs / Sheets / Slides / Meet / Drive is a
// feature of those apps, and a standalone Gemini seat is a chat surface —
// neither is an agent, so neither belongs in an agent inventory. Their
// prompt-level activity is what the AI Hub's Activity screens are for.
t("only agent-bearing platforms, no Gemini-in-app or seat rows", () => {
  const byPlat = {};
  for (const a of AG_DEMO_AGENTS) byPlat[a.platform] = (byPlat[a.platform] || 0) + 1;
  const AGENT_PLATFORMS = new Set(["vertex_ai", "gemini_enterprise", "gemini_gems", "google_chat", "apps_script"]);
  const unexpected = Object.keys(byPlat).filter(p => !AGENT_PLATFORMS.has(p));
  if (unexpected.length) throw new Error("not an agent surface: " + unexpected.join(", "));
  const missing = [...AGENT_PLATFORMS].filter(p => !byPlat[p]);
  if (missing.length) throw new Error("scope chip with no agents behind it: " + missing.join(", "));
  if (AG_DEMO_AGENTS.some(a => /^Gemini (in|Advanced)/.test(a.name))) throw new Error("a Gemini-in-app or seat row survived");
  return Object.entries(byPlat).map(([k, v]) => `${k}:${v}`).join("  ");
});

console.log("\n=== GoogleVertexView (Discovery -> a Google scope) ===");
const gv = g("/google/discover?oauth_key_id=k");
t("all eight unguarded arrays present", () => {
  for (const k of ["reasoningEngines","agentBuilderApps","dialogflowAgents","chatBots","endpoints","models","dataStores","warnings"]) {
    if (!Array.isArray(gv[k])) throw new Error(`${k} is ${gv[k] === undefined ? "MISSING" : typeof gv[k]}`);
  }
  return "all eight";
});
t("row fields render", () => {
  gv.reasoningEngines.map(re => [re.id, re.displayName, re.description, re.region, re.pythonVersion, re.createTime]);
  gv.agentBuilderApps.map(a => [a.id, a.displayName, a.location, a.solutionType, a.dataStoreCount, a.createTime]);
  gv.chatBots.map(b => { b.spaces.map(x => x); return [b.id, b.displayName, b.adminInstalled, b.firstSeen]; });
  gv.endpoints.map(ep => { void ep.deployedModels.length; return [ep.id, ep.displayName, ep.region]; });
  gv.models.map(mm => [mm.id, mm.displayName, mm.model, mm.region, mm.sourceType, mm.createTime]);
  gv.dataStores.map(ds => [ds.id, ds.displayName, ds.contentConfig, ds.createTime]);
  return `${gv.reasoningEngines.length} engines, ${gv.chatBots.length} bots, ${gv.dataStores.length} data stores`;
});

console.log("\n=== User Activity (the Google branch) ===");
for (const path of ["/google/user-activity?oauth_key_id=k", "/gemini-enterprise/data?oauth_key_id=k"]) {
  t(path, () => {
    const r = g(path);
    if (!Array.isArray(r.chats) || !Array.isArray(r.files) || !Array.isArray(r.knowledge)) throw new Error("missing chats/files/knowledge");
    if (!r.chats.length || !r.files.length || !r.knowledge.length) throw new Error("one of the three collections is empty");
    // ChatCard
    for (const c of r.chats) {
      c.messages.filter(mm => mm.from !== "bot"); c.messages.filter(mm => mm.from === "bot");
      if (Number.isNaN(new Date(c.startTime).getTime())) throw new Error("bad startTime");
      for (const mm of c.messages) if (!mm.text || !mm.fromName) throw new Error("message missing text/fromName");
    }
    // FileRow
    for (const f of r.files) {
      for (const a of f.relatedAgents || []) if (typeof a !== "string") throw new Error("relatedAgents item is not a string");
      if (Number.isNaN(new Date(f.timestamp).getTime())) throw new Error("bad timestamp");
    }
    // KnowledgeSourceCard
    const types = new Set(["sharepoint","website","dataverse_table","azure_storage","file_analysis","model_knowledge","knowledge_article","connector","uploaded_file","other"]);
    for (const b of r.knowledge) for (const src of b.sources) if (!types.has(src.type)) throw new Error("unknown source type " + src.type);
    return `${r.chats.length} chats, ${r.files.length} files, ${r.knowledge.length} knowledge sets`;
  });
}

console.log("\n=== Cost tab (Google vendor path) ===");
t("/cost/google shape + CostBreakdownTable fields", () => {
  const c = g("/cost/google?period=30");
  if (!Array.isArray(c.endpoints) || !c.endpoints.length) throw new Error("no endpoints");
  if (!c.summary || !(c.summary.totalCost > 0)) throw new Error("summary.totalCost is not positive");
  for (const ep of c.endpoints) {
    for (const k of ["endpointId","displayName","modelName","inputTokens","outputTokens","totalTokens","requestCount","inputCost","outputCost","totalCost"]) {
      if (ep[k] === undefined) throw new Error(`endpoint ${ep.displayName} missing ${k}`);
    }
  }
  // CostTab's free-tier maths keys off the model name containing "flash".
  if (!c.endpoints.some(ep => /flash/i.test(ep.modelName))) throw new Error("no flash model — the free-tier branch would never exercise");
  return `${c.endpoints.length} endpoints, $${c.summary.totalCost.toFixed(2)}, ${c.summary.totalPredictions.toLocaleString()} predictions`;
});
t("cost scales with the period", () => {
  const a = g("/cost/google?period=7").summary.totalCost, b = g("/cost/google?period=90").summary.totalCost;
  if (!(b > a)) throw new Error(`90d (${b}) is not greater than 7d (${a})`);
  return `7d $${a.toFixed(2)} < 90d $${b.toFixed(2)}`;
});

console.log("\n=== Policies / Packs / Alerts ===");
t("policies array + pack grouping", () => {
  const ps = g("/policies");
  for (const p of ps) { p.conditions.map(c => `${c.field} ${c.operator} ${c.value}`); (p.actions || []).map(a => a.type); void p.scope?.type; }
  return `${ps.length} policies, ${new Set(ps.filter(p => p.pack_id).map(p => p.pack_id)).size} pack group(s)`;
});
t("packs come back as an envelope the modal can read", () => {
  const env = g("/policy-packs");
  if (Array.isArray(env)) throw new Error("bare array — the modal reads packs.packs and would render empty");
  const rows = env.packs || [];
  if (rows.length !== 7) throw new Error(`packs.packs has ${rows.length} rows`);
  for (const pk of rows) for (const k of ["id","framework","name","ruleCount","enforceable","monitored","attestations","deployed"]) {
    if (pk[k] === undefined) throw new Error(`pack ${pk.id} missing ${k}`);
  }
  return `${rows.length} packs, ${rows.reduce((s, p) => s + p.ruleCount, 0)} rules`;
});
t("simulate: body.policies[0] resolves (un-chained in PoliciesTab)", () => {
  const body = g("/policies/simulate", "POST");
  if (!Array.isArray(body.policies)) throw new Error("no policies[] — body.policies[0] would throw and blank the page");
  const res = { ...body.policies[0], agents_evaluated: body.agents_evaluated };
  for (const k of ["would_flag","already_open","newly_flagged","severity","actions","matches"]) {
    if (res[k] === undefined) throw new Error(`policies[0] missing ${k}`);
  }
  if (!Array.isArray(res.actions) || res.actions.some(a => typeof a !== "string")) throw new Error("actions must be action-type strings");
  res.matches.map(mm => {
    if (!mm.agent_name) throw new Error("match row missing agent_name");
    if (mm.already_open === undefined) throw new Error("match row missing already_open");
    if (!mm.condition_triggered) throw new Error("match row missing condition_triggered");
  });
  return `${res.agents_evaluated} evaluated, would_flag ${res.would_flag}, ${res.matches.length} match rows`;
});
t("pack simulate aggregates per policy, not one repeated total", () => {
  const totals = new Set();
  for (const pid of ["pol_gdpr_2", "pol_gdpr_5", "pol_gdpr_7"]) {
    const b = g("/policies/simulate", "POST", JSON.stringify({ policy_id: pid }));
    const pol = b.policies?.[0];
    if (!pol) throw new Error("no policies[0] for " + pid);
    totals.add(pol.would_flag);
  }
  if (totals.size === 1) throw new Error("every policy returned the same count — conditions are not being evaluated");
  return `distinct would_flag: ${[...totals].join(", ")}`;
});
t("alerts/check", () => g("/alerts/check", "POST").alerts.map(a => a.message).length + " alerts");

console.log("\n=== NOTHING ON SCREEN MAY READ AS FABRICATED ===");
t("no payload contains 'demo' or a placeholder tenant name", () => {
  const PATHS = ["/discovery/agents", "/discovery/run", "/google/discover?oauth_key_id=k",
    "/google/user-activity?oauth_key_id=k", "/gemini-enterprise/data", "/cost/google?period=30",
    "/policies", "/policy-packs", "/policies/violations", "/alerts/check", "/oauth-keys"];
  const BANNED = [/demo/i, /northwind/i, /contoso/i, /fabrikam/i, /\bfoo\b/i, /lorem/i, /test[-_ ]?agent/i, /placeholder/i, /sample/i, /\.example\b/i];
  const hits = [];
  const walk = (node, where) => {
    if (typeof node === "string") { for (const re of BANNED) if (re.test(node)) hits.push(`${where} = ${JSON.stringify(node.slice(0, 90))}`); return; }
    if (Array.isArray(node)) { node.forEach((v, i) => walk(v, `${where}[${i}]`)); return; }
    if (node && typeof node === "object") for (const [k, v] of Object.entries(node)) {
      for (const re of BANNED) if (re.test(k)) hits.push(`${where}.${k} (key)`);
      walk(v, `${where}.${k}`);
    }
  };
  for (const p of PATHS) { const r = g(p, p === "/alerts/check" ? "POST" : "GET"); if (r === undefined || rejects(r)) continue; walk(r, p); }
  if (hits.length) throw new Error(`${hits.length} leak(s):\n      ` + hits.slice(0, 14).join("\n      "));
  return `${PATHS.length} payloads clean`;
});
t("ids and sources look like real Google resources", () => {
  const REAL = new Set(["vertex_ai_reasoning_engines","google_admin_sdk","google_chat_api","google_apps_script_api","gemini_enterprise","google_drive_api"]);
  for (const a of AG_DEMO_AGENTS) {
    if (!REAL.has(a.discoverySource)) throw new Error(`${a.name}: discoverySource "${a.discoverySource}" is not a value the product reports`);
    if (!/^(projects|spaces|gems|users|applications)\//.test(a.id)) throw new Error(`${a.name}: id "${a.id}" is not a Google resource path`);
  }
  return `${AG_DEMO_AGENTS.length} agents, all real Google resource paths and sources`;
});

console.log("\n=== lifecycle: real reads, fabricated writes suppressed ===");
t("status reads pass through to the real server", () => {
  for (const p of ["/lifecycle/blocked-agents", "/lifecycle/approval-statuses", "/lifecycle/lifecycle-statuses"]) {
    if (g(p) !== undefined) throw new Error(p + " was served locally — the AI Hub Inventory screen reads this too");
  }
  return "all three live";
});
t("a write for a fabricated agent is suppressed", () => {
  const r = g("/lifecycle/block", "POST", JSON.stringify({ agent_id: AG_DEMO_AGENTS[0].id }));
  if (r === undefined) throw new Error("a fabricated agent id reached the network");
  if (r.ok !== true) throw new Error("should still report success to the UI");
  return "suppressed, UI still sees success";
});
t("a write for a real agent goes through", () => {
  if (g("/lifecycle/block", "POST", JSON.stringify({ agent_id: "9f31c2a4-real-agent" })) !== undefined) throw new Error("a real id was suppressed");
  return "passes through";
});
t("vendor deletes stay hard no-ops", () => {
  for (const p of ["/openai/gpt?id=x", "/claude/project?id=x", "/claude/workspace/archive"]) {
    if (g(p, "DELETE", JSON.stringify({ id: "real-looking-id" })) === undefined) throw new Error(p + " would reach a real tenant");
  }
  return "nothing can delete or archive";
});

console.log("\n=== Cross-reference integrity ===");
t("every referenced agent name exists in AGENT_SPECS", () => {
  const known = new Set(AG_DEMO_AGENTS.map(a => a.name));
  const act = g("/google/user-activity?oauth_key_id=k");
  const dangling = [];
  for (const f of act.files) for (const n of f.relatedAgents || []) if (!known.has(n)) dangling.push(`file "${f.fileName}" -> "${n}"`);
  for (const c of act.chats) if (!known.has(c.botName)) dangling.push(`chat -> "${c.botName}"`);
  for (const b of act.knowledge) if (!known.has(b.botName)) dangling.push(`knowledge -> "${b.botName}"`);
  for (const al of g("/alerts/check", "POST").alerts) if (!known.has(al.agent_name)) dangling.push(`alert -> "${al.agent_name}"`);
  if (dangling.length) throw new Error(`${dangling.length} dangling: ` + dangling.join("; "));
  return "no chat, file, knowledge or alert names a non-existent agent";
});
t("AI Hub /v1 is never intercepted here", () => { if (g("/v1/overview") !== undefined) throw new Error("intercepted"); return "passes through"; });

console.log(fails === 0 ? "\nALL RENDER PATHS OK" : `\n${fails} FAILURE(S) — would break the live page`);
process.exit(fails === 0 ? 0 : 1);
