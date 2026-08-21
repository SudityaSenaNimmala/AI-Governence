/**
 * Demo mock API server — realistic static data for ALL AI Hub tabs.
 * Every tab has at least one item of each type. All buttons work in-memory.
 */
import express from "express";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

const id = () => Math.random().toString(36).slice(2, 10);
const ago = (h) => new Date(Date.now() - h * 3600000).toISOString();
const pick = (a) => a[Math.floor(Math.random() * a.length)];

// ═══════════════════════════════════════════════════════════════════════════════
// MACHINES — 15 across win32/darwin/linux
// ═══════════════════════════════════════════════════════════════════════════════
const machines = [
  { id:"m1",  hostname:"DESKTOP-ENG01",   user:"sarah.chen",      platform:"win32",  findings_count:42, unique_tools:8,  last_scan_at:ago(1) },
  { id:"m2",  hostname:"LAPTOP-MKT02",    user:"james.wilson",    platform:"darwin",  findings_count:28, unique_tools:6,  last_scan_at:ago(3) },
  { id:"m3",  hostname:"WORKSTATION-DS",   user:"priya.sharma",    platform:"linux",   findings_count:67, unique_tools:12, last_scan_at:ago(0.5) },
  { id:"m4",  hostname:"DESKTOP-PM03",     user:"alex.johnson",    platform:"win32",  findings_count:15, unique_tools:4,  last_scan_at:ago(6) },
  { id:"m5",  hostname:"LAPTOP-SEC01",     user:"maya.patel",      platform:"darwin",  findings_count:53, unique_tools:9,  last_scan_at:ago(2) },
  { id:"m6",  hostname:"DESKTOP-FIN04",    user:"david.kim",       platform:"win32",  findings_count:31, unique_tools:7,  last_scan_at:ago(4) },
  { id:"m7",  hostname:"MACBOOK-DESIGN",   user:"emma.rodriguez",  platform:"darwin",  findings_count:19, unique_tools:5,  last_scan_at:ago(1) },
  { id:"m8",  hostname:"UBUNTU-DEVOPS",    user:"raj.gupta",       platform:"linux",   findings_count:88, unique_tools:15, last_scan_at:ago(0.2) },
  { id:"m9",  hostname:"DESKTOP-LEGAL01",  user:"lisa.thompson",   platform:"win32",  findings_count:8,  unique_tools:3,  last_scan_at:ago(12) },
  { id:"m10", hostname:"LAPTOP-HR02",      user:"carlos.mendez",   platform:"darwin",  findings_count:22, unique_tools:5,  last_scan_at:ago(5) },
  { id:"m11", hostname:"SERVER-ML01",      user:"aisha.hassan",    platform:"linux",   findings_count:104,unique_tools:18, last_scan_at:ago(0.1) },
  { id:"m12", hostname:"DESKTOP-SALES05",  user:"tom.baker",       platform:"win32",  findings_count:12, unique_tools:4,  last_scan_at:ago(24) },
  { id:"m13", hostname:"LAPTOP-EXEC01",    user:"jennifer.wong",   platform:"darwin",  findings_count:35, unique_tools:7,  last_scan_at:ago(2) },
  { id:"m14", hostname:"WORKSTATION-QA",   user:"mikhail.petrov",  platform:"linux",   findings_count:45, unique_tools:10, last_scan_at:ago(3) },
  { id:"m15", hostname:"DESKTOP-SUPPORT",  user:"nina.garcia",     platform:"win32",  findings_count:17, unique_tools:4,  last_scan_at:ago(8) },
];

// ═══════════════════════════════════════════════════════════════════════════════
// AI SYSTEMS — 36 covering all statuses, risk levels, sources, categories
// ═══════════════════════════════════════════════════════════════════════════════
const aiSystems = [
  // Endpoints — browser-detected tools
  { id:"r1",  name:"ChatGPT",           vendor:"OpenAI",       platform:"chat.openai.com",       category:"endpoint",       status:"blocked",  risk_score:45, risk_level:"medium",   risk_factors:["High data volume","External API"],   owner:"Security Team",   source:"endpoint_scan",  first_seen:ago(720),  activity:{total:2975, last_active:ago(2)},   matched_hosts:["chat.openai.com"] },
  { id:"r2",  name:"Claude",            vendor:"Anthropic",    platform:"claude.ai",             category:"endpoint",       status:"approved", risk_score:15, risk_level:"low",      risk_factors:[],                                     owner:"Engineering",     source:"endpoint_scan",  first_seen:ago(480),  activity:{total:1422, last_active:ago(4)},   matched_hosts:["claude.ai"] },
  { id:"r3",  name:"Gemini",            vendor:"Google",       platform:"gemini.google.com",     category:"endpoint",       status:"approved", risk_score:20, risk_level:"low",      risk_factors:[],                                     owner:"Product",         source:"endpoint_scan",  first_seen:ago(360),  activity:{total:442,  last_active:ago(12)},  matched_hosts:["gemini.google.com"] },
  { id:"r4",  name:"Perplexity",        vendor:"Perplexity",   platform:"perplexity.ai",         category:"endpoint",       status:"approved", risk_score:22, risk_level:"low",      risk_factors:[],                                     owner:null,              source:"endpoint_scan",  first_seen:ago(240),  activity:{total:276,  last_active:ago(48)},  matched_hosts:["perplexity.ai"] },
  { id:"r5",  name:"Claude Code",       vendor:"Anthropic",    platform:"claude.ai",             category:"endpoint",       status:"approved", risk_score:12, risk_level:"low",      risk_factors:[],                                     owner:"Engineering",     source:"endpoint_scan",  first_seen:ago(200),  activity:{total:654,  last_active:ago(6)},   matched_hosts:[] },
  { id:"r6",  name:"Cursor",            vendor:"Anysphere",    platform:"cursor.sh",             category:"endpoint",       status:"approved", risk_score:25, risk_level:"low",      risk_factors:["Code access"],                        owner:"Engineering",     source:"endpoint_scan",  first_seen:ago(500),  activity:{total:312,  last_active:ago(24)},  matched_hosts:["cursor.sh"] },
  { id:"r7",  name:"GitHub Copilot",    vendor:"GitHub",       platform:"github.com",            category:"endpoint",       status:"approved", risk_score:18, risk_level:"low",      risk_factors:[],                                     owner:"Engineering",     source:"endpoint_scan",  first_seen:ago(900),  activity:{total:1089, last_active:ago(3)},   matched_hosts:["github.com"] },
  { id:"r8",  name:"Midjourney",        vendor:"Midjourney",   platform:"midjourney.com",        category:"endpoint",       status:"unknown",  risk_score:null,risk_level:null,      risk_factors:[],                                     owner:null,              source:"endpoint_scan",  first_seen:ago(100),  activity:{total:45,   last_active:ago(72)},  matched_hosts:["midjourney.com"] },
  { id:"r9",  name:"Jasper AI",         vendor:"Jasper",       platform:"jasper.ai",             category:"endpoint",       status:"unknown",  risk_score:null,risk_level:null,      risk_factors:[],                                     owner:null,              source:"endpoint_scan",  first_seen:ago(50),   activity:{total:12,   last_active:ago(120)}, matched_hosts:["jasper.ai"] },
  { id:"r10", name:"Notion AI",         vendor:"Notion",       platform:"notion.so",             category:"endpoint",       status:"approved", risk_score:28, risk_level:"low",      risk_factors:["Workspace data access"],               owner:"Product",         source:"endpoint_scan",  first_seen:ago(300),  activity:{total:567,  last_active:ago(1)},   matched_hosts:["notion.so"] },
  { id:"r11", name:"Grammarly AI",      vendor:"Grammarly",    platform:"grammarly.com",         category:"endpoint",       status:"approved", risk_score:15, risk_level:"low",      risk_factors:[],                                     owner:"HR",              source:"endpoint_scan",  first_seen:ago(600),  activity:{total:2340, last_active:ago(0.5)}, matched_hosts:["grammarly.com"] },
  { id:"r12", name:"DeepSeek",          vendor:"DeepSeek",     platform:"chat.deepseek.com",     category:"endpoint",       status:"blocked",  risk_score:72, risk_level:"high",     risk_factors:["China-hosted","Data residency risk"], owner:"Security Team",   source:"endpoint_scan",  first_seen:ago(30),   activity:{total:8,    last_active:ago(168)}, matched_hosts:["chat.deepseek.com"] },
  { id:"r13", name:"Hugging Face Chat", vendor:"Hugging Face", platform:"huggingface.co",        category:"endpoint",       status:"approved", risk_score:30, risk_level:"medium",   risk_factors:["Open models"],                        owner:"ML Team",         source:"endpoint_scan",  first_seen:ago(400),  activity:{total:89,   last_active:ago(36)},  matched_hosts:["huggingface.co"] },
  { id:"r14", name:"Writesonic",        vendor:"Writesonic",   platform:"writesonic.com",        category:"endpoint",       status:"unknown",  risk_score:null,risk_level:null,      risk_factors:[],                                     owner:null,              source:"endpoint_scan",  first_seen:ago(20),   activity:{total:3,    last_active:ago(200)}, matched_hosts:["writesonic.com"] },
  // Copilot Studio agents — governance-discovered
  { id:"r15", name:"Microsoft Copilot",       vendor:"Microsoft", platform:"copilot.microsoft.com", category:"copilot_studio", status:"approved", risk_score:10, risk_level:"low",     risk_factors:[], owner:"IT",          source:"governance", first_seen:ago(1200), activity:{total:891,  last_active:ago(1)},  matched_hosts:["copilot.microsoft.com"] },
  { id:"r16", name:"Enterprise Agent",        vendor:"Microsoft", platform:"copilot_studio",        category:"copilot_studio", status:"approved", risk_score:35, risk_level:"medium",  risk_factors:["Broad permissions","AllPrincipals consent"], owner:"Erik E",      source:"governance", first_seen:ago(600),  activity:{total:34,   last_active:ago(6)},  matched_hosts:[] },
  { id:"r17", name:"Customer Service Bot",    vendor:"Microsoft", platform:"copilot_studio",        category:"copilot_studio", status:"approved", risk_score:42, risk_level:"medium",  risk_factors:["External facing","Customer PII"],    owner:"Support",     source:"governance", first_seen:ago(400),  activity:{total:1560, last_active:ago(0.5)},matched_hosts:[] },
  { id:"r18", name:"HR Benefits Agent",       vendor:"Microsoft", platform:"copilot_studio",        category:"copilot_studio", status:"approved", risk_score:55, risk_level:"medium",  risk_factors:["PII access","Payroll data"],          owner:"HR",          source:"governance", first_seen:ago(300),  activity:{total:234,  last_active:ago(3)},  matched_hosts:[] },
  { id:"r19", name:"IT Help Desk Bot",        vendor:"Microsoft", platform:"copilot_studio",        category:"copilot_studio", status:"approved", risk_score:48, risk_level:"medium",  risk_factors:["Admin permissions"],                  owner:"IT",          source:"governance", first_seen:ago(500),  activity:{total:890,  last_active:ago(1)},  matched_hosts:[] },
  { id:"r20", name:"Sales Forecast Agent",    vendor:"Microsoft", platform:"copilot_studio",        category:"copilot_studio", status:"approved", risk_score:38, risk_level:"medium",  risk_factors:["CRM data access"],                   owner:"Sales",       source:"governance", first_seen:ago(200),  activity:{total:67,   last_active:ago(12)}, matched_hosts:[] },
  { id:"r21", name:"Legal Review Agent",      vendor:"Microsoft", platform:"copilot_studio",        category:"copilot_studio", status:"approved", risk_score:62, risk_level:"high",    risk_factors:["Confidential docs","Legal privilege"],owner:"Legal",       source:"governance", first_seen:ago(150),  activity:{total:23,   last_active:ago(24)}, matched_hosts:[] },
  { id:"r22", name:"Compliance Monitor Bot",  vendor:"Microsoft", platform:"copilot_studio",        category:"copilot_studio", status:"approved", risk_score:78, risk_level:"critical",risk_factors:["Cross-tenant access","Audit data"],   owner:"Compliance",  source:"governance", first_seen:ago(100),  activity:{total:12,   last_active:ago(48)}, matched_hosts:[] },
  // Platform services — from catalog
  { id:"r23", name:"Azure OpenAI",      vendor:"Microsoft",  platform:"openai.azure.com",    category:"ai-platform",    status:"approved", risk_score:20, risk_level:"low",     risk_factors:[], owner:"Engineering", source:"platform_registry", first_seen:ago(800),activity:{total:3400, last_active:ago(0.2)},matched_hosts:["openai.azure.com"] },
  { id:"r24", name:"AWS Bedrock",       vendor:"Amazon",     platform:"bedrock.amazonaws.com",category:"ai-platform",   status:"approved", risk_score:22, risk_level:"low",     risk_factors:[], owner:"DevOps",      source:"platform_registry", first_seen:ago(500),activity:{total:1200, last_active:ago(1)},  matched_hosts:["bedrock.amazonaws.com"] },
  { id:"r25", name:"Vertex AI",         vendor:"Google",     platform:"aiplatform.googleapis.com",category:"ai-platform",status:"approved", risk_score:18, risk_level:"low",     risk_factors:[], owner:"ML Team",     source:"platform_registry", first_seen:ago(400),activity:{total:780,  last_active:ago(4)},  matched_hosts:["aiplatform.googleapis.com"] },
  // High-risk/critical items
  { id:"r26", name:"Shadow AI Tool",    vendor:"Unknown",    platform:"sketchy-ai.io",       category:"endpoint",       status:"blocked",  risk_score:90, risk_level:"critical", risk_factors:["Unknown vendor","No TOS","Data harvesting suspected"], owner:null, source:"endpoint_scan", first_seen:ago(10), activity:{total:2, last_active:ago(168)}, matched_hosts:["sketchy-ai.io"] },
  { id:"r27", name:"Rogue GPT Wrapper", vendor:"Unknown",    platform:"freegpt.xyz",         category:"endpoint",       status:"blocked",  risk_score:85, risk_level:"critical", risk_factors:["Proxy to OpenAI","Credential theft risk"], owner:null, source:"endpoint_scan", first_seen:ago(5), activity:{total:1, last_active:ago(200)}, matched_hosts:["freegpt.xyz"] },
  // Inactive/zero-activity systems (for not_assessed filter)
  { id:"r28", name:"Cohere",            vendor:"Cohere",     platform:"cohere.com",          category:"endpoint",       status:"unknown",  risk_score:null,risk_level:null, risk_factors:[], owner:null, source:"endpoint_scan", first_seen:ago(60), activity:{total:0, last_active:null}, matched_hosts:["cohere.com"] },
  { id:"r29", name:"Anthropic API",     vendor:"Anthropic",  platform:"api.anthropic.com",   category:"ai-platform",    status:"approved", risk_score:14, risk_level:"low", risk_factors:[], owner:"Engineering", source:"platform_registry", first_seen:ago(300), activity:{total:4500, last_active:ago(0.1)}, matched_hosts:["api.anthropic.com"] },
  { id:"r30", name:"Stability AI",      vendor:"Stability",  platform:"stability.ai",        category:"endpoint",       status:"unknown",  risk_score:null,risk_level:null, risk_factors:[], owner:null, source:"endpoint_scan", first_seen:ago(40), activity:{total:0, last_active:null}, matched_hosts:["stability.ai"] },
  { id:"r31", name:"Aider",             vendor:"Aider",      platform:"aider.chat",          category:"endpoint",       status:"approved", risk_score:28, risk_level:"low", risk_factors:["Code access"], owner:"Engineering", source:"endpoint_scan", first_seen:ago(150), activity:{total:178, last_active:ago(8)}, matched_hosts:[] },
  { id:"r32", name:"Windsurf",          vendor:"Codeium",    platform:"windsurf.ai",         category:"endpoint",       status:"approved", risk_score:24, risk_level:"low", risk_factors:["Code access"], owner:"Engineering", source:"endpoint_scan", first_seen:ago(90),  activity:{total:95,  last_active:ago(16)}, matched_hosts:["windsurf.ai"] },
  { id:"r33", name:"Bolt.new",          vendor:"StackBlitz",  platform:"bolt.new",           category:"endpoint",       status:"unknown",  risk_score:null,risk_level:null, risk_factors:[], owner:null, source:"endpoint_scan", first_seen:ago(15), activity:{total:5, last_active:ago(96)}, matched_hosts:["bolt.new"] },
  { id:"r34", name:"Lovable",           vendor:"Lovable",     platform:"lovable.dev",        category:"endpoint",       status:"unknown",  risk_score:null,risk_level:null, risk_factors:[], owner:null, source:"endpoint_scan", first_seen:ago(8),  activity:{total:2, last_active:ago(120)}, matched_hosts:["lovable.dev"] },
  { id:"r35", name:"v0 by Vercel",      vendor:"Vercel",      platform:"v0.dev",             category:"endpoint",       status:"approved", risk_score:26, risk_level:"low", risk_factors:["Code generation"], owner:"Engineering", source:"endpoint_scan", first_seen:ago(120), activity:{total:134, last_active:ago(10)}, matched_hosts:["v0.dev"] },
  { id:"r36", name:"Replit AI",         vendor:"Replit",      platform:"replit.com",          category:"endpoint",       status:"approved", risk_score:32, risk_level:"medium", risk_factors:["Code execution","Cloud hosted"], owner:"Engineering", source:"endpoint_scan", first_seen:ago(200), activity:{total:67, last_active:ago(36)}, matched_hosts:["replit.com"] },
];

const aiPlatforms = [
  { host:"chat.openai.com",     product:"ChatGPT",          vendor:"OpenAI",     blocked:true,  governed:true,  category:"ai-chatbot" },
  { host:"claude.ai",           product:"Claude",            vendor:"Anthropic",  blocked:false, governed:true,  category:"ai-chatbot" },
  { host:"gemini.google.com",   product:"Gemini",            vendor:"Google",     blocked:false, governed:true,  category:"ai-chatbot" },
  { host:"copilot.microsoft.com",product:"Microsoft Copilot",vendor:"Microsoft", blocked:false, governed:true,  category:"ai-assistant" },
  { host:"perplexity.ai",       product:"Perplexity",        vendor:"Perplexity", blocked:false, governed:true,  category:"ai-search" },
  { host:"chat.deepseek.com",   product:"DeepSeek",          vendor:"DeepSeek",   blocked:true,  governed:true,  category:"ai-chatbot" },
  { host:"sketchy-ai.io",       product:"Shadow AI Tool",    vendor:"Unknown",    blocked:true,  governed:false, category:"ai-chatbot" },
  { host:"freegpt.xyz",         product:"Rogue GPT Wrapper", vendor:"Unknown",    blocked:true,  governed:false, category:"ai-chatbot" },
];

// ═══════════════════════════════════════════════════════════════════════════════
// DLP EVENTS — 540 events across all severities, sources, services, kinds
// ═══════════════════════════════════════════════════════════════════════════════
const dlpEvents = [];
const sevs = ["critical","high","medium","low"];
const svcNames = ["ChatGPT","Claude","Gemini","Perplexity","Microsoft Copilot","GitHub Copilot","Notion AI","Grammarly AI","Azure OpenAI","Cursor"];
const pats = ["SSN","API Key","Credit Card","Email PII","AWS Access Key","Bearer Token","Prompt Injection","Jailbreak Attempt","Internal URL","Private Key","Database Credentials","Phone Number"];
const kinds = ["prompt_paste","prompt_submit","prompt_typed","file_upload"];
const sources = ["browser_extension","desktop_hook","os_monitor"];
for (let i = 0; i < 540; i++) {
  const sev = i < 60 ? "critical" : i < 180 ? "high" : i < 400 ? "medium" : "low";
  const m = machines[i % machines.length];
  dlpEvents.push({
    id:"dlp-"+id(), occurred_at:ago(Math.random()*720),
    ai_service:svcNames[i%svcNames.length], event_kind:kinds[i%kinds.length],
    secret_class:sev, severity:sev, highest_severity:sev,
    pattern_matched:pats[i%pats.length],
    source:sources[i%sources.length],
    machine_id:m.id, user:m.user, hostname:m.hostname,
    has_content:i%3===0,
    platform:{product:svcNames[i%svcNames.length],vendor:"vendor"},
  });
}

// DLP Files — 30 file upload events
const dlpFiles = [];
for (let i = 0; i < 30; i++) {
  const m = machines[i % machines.length];
  dlpFiles.push({
    id:"file-"+id(), occurred_at:ago(Math.random()*500),
    ai_service:svcNames[i%svcNames.length], event_kind:"file_upload",
    severity:sevs[i%4], highest_severity:sevs[i%4],
    filename:["report.pdf","credentials.json","database_dump.sql","employee_list.xlsx","api_keys.env","meeting_notes.docx","salary_data.csv","source_code.zip","passport_scan.jpg","nda_contract.pdf"][i%10],
    content_type:["application/pdf","application/json","text/sql","application/xlsx","text/plain","application/docx","text/csv","application/zip","image/jpeg","application/pdf"][i%10],
    content_length:Math.floor(Math.random()*5000000)+10000,
    source:sources[i%3], machine_id:m.id, user:m.user, hostname:m.hostname,
    has_content:true,
    platform:{product:svcNames[i%svcNames.length],vendor:"vendor"},
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// FINDINGS — MCP servers (8) + Agent projects (15)
// ═══════════════════════════════════════════════════════════════════════════════
const mcpFindings = [
  { machine_id:"m1",  type:"mcp_server", payload:{client:"Claude Code",serverName:"filesystem",  scopes:["read","write"],           command:"npx",args:["-y","@anthropic/mcp-fs"],       configPath:"~/.claude/config.json"}, detected_at:ago(12) },
  { machine_id:"m3",  type:"mcp_server", payload:{client:"Claude Code",serverName:"postgres",    scopes:["query"],                  command:"npx",args:["-y","@anthropic/mcp-postgres"],  configPath:"~/.claude/config.json"}, detected_at:ago(24) },
  { machine_id:"m5",  type:"mcp_server", payload:{client:"Cursor",     serverName:"github",      scopes:["read","write","admin"],   command:"npx",args:["-y","@anthropic/mcp-github"],    configPath:"~/.cursor/config.json"}, detected_at:ago(6) },
  { machine_id:"m8",  type:"mcp_server", payload:{client:"Claude Code",serverName:"docker",      scopes:["containers","images"],    command:"npx",args:["-y","@anthropic/mcp-docker"],    configPath:"~/.claude/config.json"}, detected_at:ago(3) },
  { machine_id:"m8",  type:"mcp_server", payload:{client:"Claude Code",serverName:"kubernetes",   scopes:["pods","deployments"],     command:"npx",args:["-y","@anthropic/mcp-k8s"],       configPath:"~/.claude/config.json"}, detected_at:ago(4) },
  { machine_id:"m11", type:"mcp_server", payload:{client:"Claude Code",serverName:"sqlite",      scopes:["query","write"],          command:"npx",args:["-y","@anthropic/mcp-sqlite"],    configPath:"~/.claude/config.json"}, detected_at:ago(8) },
  { machine_id:"m14", type:"mcp_server", payload:{client:"Cursor",     serverName:"jira",        scopes:["read","create"],          command:"npx",args:["-y","@anthropic/mcp-jira"],      configPath:"~/.cursor/config.json"}, detected_at:ago(18) },
  { machine_id:"m3",  type:"mcp_server", payload:{client:"Claude Code",serverName:"slack",       scopes:["read","post"],            command:"npx",args:["-y","@anthropic/mcp-slack"],     configPath:"~/.claude/config.json"}, detected_at:ago(2) },
];

const agentFindings = [
  // AI coding agents
  { machine_id:"m1",  type:"agent_project", payload:{primaryCategory:"ai_coding_agent",path:"/Users/sarah/projects/webapp",        language:"TypeScript", frameworks:["Claude Code"],              lastModified:ago(2)},  detected_at:ago(2) },
  { machine_id:"m5",  type:"agent_project", payload:{primaryCategory:"ai_coding_agent",path:"/Users/maya/code/api-server",         language:"Python",     frameworks:["Cursor","Aider"],           lastModified:ago(8)},  detected_at:ago(8) },
  { machine_id:"m8",  type:"agent_project", payload:{primaryCategory:"ai_coding_agent",path:"/home/raj/services/auth-service",     language:"Go",         frameworks:["Claude Code"],              lastModified:ago(1)},  detected_at:ago(1) },
  { machine_id:"m11", type:"agent_project", payload:{primaryCategory:"ai_coding_agent",path:"/home/aisha/ml/training-pipeline",    language:"Python",     frameworks:["Cursor"],                   lastModified:ago(4)},  detected_at:ago(4) },
  { machine_id:"m14", type:"agent_project", payload:{primaryCategory:"ai_coding_agent",path:"/home/mikhail/qa/test-automation",    language:"Python",     frameworks:["Aider"],                    lastModified:ago(6)},  detected_at:ago(6) },
  { machine_id:"m7",  type:"agent_project", payload:{primaryCategory:"ai_coding_agent",path:"/Users/emma/design-system",           language:"TypeScript", frameworks:["Windsurf"],                 lastModified:ago(12)}, detected_at:ago(12) },
  // Autonomous AI agents
  { machine_id:"m3",  type:"agent_project", payload:{primaryCategory:"ai_agent",       path:"/home/priya/agents/data-pipeline",    language:"Python",     frameworks:["LangChain","AutoGen"],      lastModified:ago(3)},  detected_at:ago(3) },
  { machine_id:"m8",  type:"agent_project", payload:{primaryCategory:"ai_agent",       path:"/home/raj/agents/monitoring-bot",     language:"Python",     frameworks:["CrewAI","LangChain"],       lastModified:ago(5)},  detected_at:ago(5) },
  { machine_id:"m11", type:"agent_project", payload:{primaryCategory:"ai_agent",       path:"/home/aisha/agents/research-agent",   language:"Python",     frameworks:["LlamaIndex","MCP SDK"],     lastModified:ago(10)}, detected_at:ago(10) },
  { machine_id:"m3",  type:"agent_project", payload:{primaryCategory:"ai_agent",       path:"/home/priya/agents/slack-responder",  language:"Python",     frameworks:["LangGraph"],                lastModified:ago(7)},  detected_at:ago(7) },
  // AI-using apps (call LLM APIs)
  { machine_id:"m2",  type:"agent_project", payload:{primaryCategory:"ai_app",         path:"/Users/james/marketing-ai",           language:"JavaScript", frameworks:["OpenAI SDK"],               lastModified:ago(24)}, detected_at:ago(24) },
  { machine_id:"m4",  type:"agent_project", payload:{primaryCategory:"ai_app",         path:"C:\\Users\\alex\\chatbot",            language:"Python",     frameworks:["OpenAI SDK"],               lastModified:ago(48)}, detected_at:ago(48) },
  { machine_id:"m6",  type:"agent_project", payload:{primaryCategory:"ai_app",         path:"C:\\Users\\david\\fin-analyzer",      language:"Python",     frameworks:["Anthropic SDK"],            lastModified:ago(20)}, detected_at:ago(20) },
  { machine_id:"m10", type:"agent_project", payload:{primaryCategory:"ai_app",         path:"/Users/carlos/hr-assistant",          language:"TypeScript", frameworks:["OpenAI SDK","Vercel AI"],   lastModified:ago(36)}, detected_at:ago(36) },
  { machine_id:"m13", type:"agent_project", payload:{primaryCategory:"ai_app",         path:"/Users/jennifer/exec-briefing",       language:"Python",     frameworks:["Anthropic SDK","LangChain"],lastModified:ago(15)}, detected_at:ago(15) },
];

// ═══════════════════════════════════════════════════════════════════════════════
// POLICIES — 8 custom policies
// ═══════════════════════════════════════════════════════════════════════════════
let policies = [
  { id:"pol1", name:"Broad Permissions Review",   description:"Flag agents with admin-consented (AllPrincipals) permissions for quarterly security review.", type:"risk",      severity:"high",     status:"active",   template:true, conditions:[{field:"consent_type",operator:"equals",value:"AllPrincipals"}],                     actions:[{type:"flag"},{type:"notify"}],    scope:{type:"all"} },
  { id:"pol2", name:"High-Risk Auto Suspension",  description:"Automatically suspend agents scoring above 75 (critical risk). Requires manual review.",     type:"risk",      severity:"critical", status:"active",   template:true, conditions:[{field:"risk_score",operator:"greater_than",value:75}],                              actions:[{type:"suspend"},{type:"notify"}], scope:{type:"all"} },
  { id:"pol3", name:"Sensitive Connector Alert",   description:"Alert when an agent uses HTTP or SQL connectors for external data egress.",                  type:"connector", severity:"high",     status:"active",   template:true, conditions:[{field:"has_http_connector",operator:"is_true",value:true}],                         actions:[{type:"notify"},{type:"escalate"}],scope:{type:"all"} },
  { id:"pol4", name:"90-Day Renewal Policy",       description:"Agents must be re-certified every 90 days. Expired agents are flagged for review.",          type:"lifecycle", severity:"medium",   status:"active",   template:true, conditions:[{field:"days_since_last_activity",operator:"greater_than",value:90}],               actions:[{type:"notify"},{type:"flag"}],    scope:{type:"all"} },
  { id:"pol5", name:"Orphan Agent Escalation",     description:"Escalate agents whose owner is disabled or deleted within 24 hours of detection.",           type:"orphan",    severity:"high",     status:"active",   template:true, conditions:[{field:"is_orphaned",operator:"is_true",value:true}],                                actions:[{type:"escalate"},{type:"flag"}],  scope:{type:"all"} },
  { id:"pol6", name:"Stale Agent Detection",       description:"Flag agents with no activity in 30+ days for review and potential archival.",                type:"stale",     severity:"medium",   status:"active",   template:true, conditions:[{field:"days_since_last_activity",operator:"greater_than",value:30}],               actions:[{type:"flag"}],                   scope:{type:"all"} },
  { id:"pol7", name:"Excessive Permission Count",  description:"Flag agents with more than 10 permissions for manual review.",                               type:"risk",      severity:"medium",   status:"active",   template:false,conditions:[{field:"permission_count",operator:"greater_than",value:10}],              actions:[{type:"flag"},{type:"notify"}],    scope:{type:"all"} },
  { id:"pol8", name:"High Invocation Monitor",     description:"Alert when an agent exceeds 1000 invocations — may indicate runaway automation.",           type:"custom",    severity:"high",     status:"disabled", template:false,conditions:[{field:"total_invocations",operator:"greater_than",value:1000}],          actions:[{type:"notify"}],                 scope:{type:"all"} },
];

// ═══════════════════════════════════════════════════════════════════════════════
// POLICY PACKS — same 7 frameworks
// ═══════════════════════════════════════════════════════════════════════════════
const policyPacks = {
  packs:[
    { id:"gdpr",         framework:"GDPR",         name:"GDPR Compliance Pack",         ruleCount:20, enforceable:7, monitored:3, attestations:10, deployed:false, version:1 },
    { id:"hipaa",        framework:"HIPAA",         name:"HIPAA Compliance Pack",        ruleCount:15, enforceable:7, monitored:2, attestations:6,  deployed:false, version:1 },
    { id:"soc-2",        framework:"SOC 2",         name:"SOC 2 Compliance Pack",        ruleCount:13, enforceable:7, monitored:1, attestations:5,  deployed:false, version:1 },
    { id:"ccpa-cpra",    framework:"CCPA/CPRA",     name:"CCPA/CPRA Compliance Pack",    ruleCount:12, enforceable:5, monitored:2, attestations:5,  deployed:false, version:1 },
    { id:"eu-ai-act",    framework:"EU AI Act",     name:"EU AI Act Compliance Pack",    ruleCount:15, enforceable:2, monitored:3, attestations:10, deployed:false, version:1 },
    { id:"iso-iec-42001",framework:"ISO/IEC 42001", name:"ISO/IEC 42001 Pack",           ruleCount:13, enforceable:4, monitored:2, attestations:7,  deployed:false, version:1 },
    { id:"nist-ai-rmf",  framework:"NIST AI RMF",   name:"NIST AI RMF Pack",             ruleCount:21, enforceable:7, monitored:4, attestations:10, deployed:false, version:1 },
  ],
  definition_problems:[],
};

// ═══════════════════════════════════════════════════════════════════════════════
// ACCESS REQUESTS — 6 requests covering all statuses + 2 active exceptions
// ═══════════════════════════════════════════════════════════════════════════════
const accessRequests = [
  { id:"ar8", tool_name:"Claude",      tool_host:"claude.ai",        tool_vendor:"Anthropic",  employee_name:"Suditya Nimmala", machine_id:"m1",  status:"pending",  reason:"Hi can you allow me please",                                                    submitted_at:ago(0.5) },
  { id:"ar1", tool_name:"ChatGPT",     tool_host:"chat.openai.com",  tool_vendor:"OpenAI",     employee_name:"James Wilson",    machine_id:"m2",  status:"pending",  reason:"Need ChatGPT for marketing copy generation and A/B test ideas.",                submitted_at:ago(2) },
  { id:"ar2", tool_name:"Midjourney",   tool_host:"midjourney.com",   tool_vendor:"Midjourney", employee_name:"Alex Johnson",    machine_id:"m4",  status:"pending",  reason:"Creating product mockups and visual assets for Q4 launch.",                     submitted_at:ago(8) },
  { id:"ar3", tool_name:"DeepSeek",     tool_host:"chat.deepseek.com",tool_vendor:"DeepSeek",   employee_name:"Raj Gupta",       machine_id:"m8",  status:"pending",  reason:"Comparing model performance for our benchmark study.",                           submitted_at:ago(1) },
  { id:"ar4", tool_name:"ChatGPT",     tool_host:"chat.openai.com",  tool_vendor:"OpenAI",     employee_name:"Sarah Chen",      machine_id:"m1",  status:"approved", reason:"Research and code review assistance.",                                          submitted_at:ago(96), reviewed_at:ago(94), expires_at:new Date(Date.now()+72*3600000).toISOString() },
  { id:"ar5", tool_name:"Jasper AI",   tool_host:"jasper.ai",        tool_vendor:"Jasper",     employee_name:"Maya Patel",      machine_id:"m5",  status:"rejected", reason:"Content drafting for blog posts.",                                              submitted_at:ago(120),reviewed_at:ago(118) },
  { id:"ar6", tool_name:"ChatGPT",     tool_host:"chat.openai.com",  tool_vendor:"OpenAI",     employee_name:"Tom Baker",       machine_id:"m12", status:"approved", reason:"Customer demo preparation.",                                                    submitted_at:ago(200),reviewed_at:ago(198),expires_at:new Date(Date.now()-24*3600000).toISOString() },
  { id:"ar7", tool_name:"Bolt.new",    tool_host:"bolt.new",         tool_vendor:"StackBlitz", employee_name:"Emma Rodriguez",  machine_id:"m7",  status:"revoked",  reason:"Prototyping landing pages.",                                                    submitted_at:ago(300),reviewed_at:ago(298) },
];

const accessExceptions = [
  { request_id:"ar4", tool_name:"ChatGPT", machine_id:"m1",  granted_at:ago(94), expires_at:new Date(Date.now()+72*3600000).toISOString() },
  { request_id:"ar6", tool_name:"ChatGPT", machine_id:"m12", granted_at:ago(198),expires_at:new Date(Date.now()-24*3600000).toISOString() },
];

// ═══════════════════════════════════════════════════════════════════════════════
// RISK SCORES — per machine
// ═══════════════════════════════════════════════════════════════════════════════
const riskScores = machines.map((m,i) => ({
  id:"rs-"+m.id, machine_id:m.id, hostname:m.hostname, user:m.user, platform:m.platform,
  display_name:m.user.split(".").map(s=>s[0].toUpperCase()+s.slice(1)).join(" "),
  email:m.user+"@company.com",
  risk_score:[15,32,68,22,45,28,18,72,8,25,82,12,40,38,20][i],
  risk_level:["low","medium","high","low","medium","low","low","high","low","low","critical","low","medium","medium","low"][i],
  sources:[ ["browser_extension"],["browser_extension","desktop_hook"],["desktop_hook","os_monitor"],["browser_extension"],["browser_extension","os_monitor"],
    ["browser_extension"],["browser_extension"],["desktop_hook","os_monitor","browser_extension"],["browser_extension"],["browser_extension"],
    ["os_monitor","desktop_hook"],["browser_extension"],["browser_extension","desktop_hook"],["desktop_hook"],["browser_extension"] ][i],
  risk_computed_at:ago(Math.random()*48),
  factors:[ ["AI tool usage"],["DLP events","Multiple tools"],["High-risk agents","Autonomous code"],["AI tool usage"],["DLP events","Blocked tool attempts"],
    ["AI tool usage"],["Design tool access"],["Admin permissions","MCP servers","Autonomous agents"],["Minimal usage"],["AI tool usage"],
    ["Critical agents","ML model access","Cross-tenant"],["Minimal usage"],["Executive data access"],["QA automation"],["Support tools"] ][i],
  dlp_events:[42,28,67,15,53,31,19,88,8,22,104,12,35,45,17][i],
  tools_used:[8,6,12,4,9,7,5,15,3,5,18,4,7,10,4][i],
  last_updated:ago(Math.random()*48),
}));

// ═══════════════════════════════════════════════════════════════════════════════
// WEBHOOKS & CONNECTIONS
// ═══════════════════════════════════════════════════════════════════════════════
const webhooks = [
  { id:"wh1", name:"Slack DLP Alerts",       url:"direct://slack", template:"slack", triggers:["dlp_critical","risk_score_high"],         enabled:true,  connection_type:"slack",channel_id:"C0123456" },
  { id:"wh2", name:"Teams Security Alerts",  url:"direct://teams", template:"teams", triggers:["risk_score_high","tool_blocked"],          enabled:true,  connection_type:"teams",channel_id:"19:abc123" },
  { id:"wh3", name:"Jira Ticket Creator",    url:"https://company.atlassian.net/webhook/ai-gov",template:"jira",triggers:["dlp_critical"], enabled:true },
  { id:"wh4", name:"PagerDuty Critical",     url:"https://events.pagerduty.com/generic/fake",  template:"custom",triggers:["dlp_critical","tool_blocked"],enabled:false },
];
const connections = [
  { type:"slack",     name:"Slack",          icon:"💬", description:"Send alerts to Slack channels",       status:"configured" },
  { type:"teams",     name:"Microsoft Teams", icon:"👥", description:"Send alerts to Teams channels",       status:"configured" },
  { type:"jira",      name:"Jira",           icon:"🎫", description:"Create Jira tickets for violations",  status:"configured" },
  { type:"servicenow",name:"ServiceNow",     icon:"🔧", description:"Open ServiceNow incidents",           status:"not_configured" },
];

// ═══════════════════════════════════════════════════════════════════════════════
// CLAUDE USAGE
// ═══════════════════════════════════════════════════════════════════════════════
const claudeUsers = [
  { user:"sarah.chen",     hostname:"DESKTOP-ENG01",  product:"Claude Code",    tokens_in:85000,  tokens_out:42000,  sessions:34, last_active:ago(1) },
  { user:"priya.sharma",   hostname:"WORKSTATION-DS",  product:"Claude Code",    tokens_in:120000, tokens_out:65000,  sessions:52, last_active:ago(0.5) },
  { user:"raj.gupta",      hostname:"UBUNTU-DEVOPS",   product:"Claude Code",    tokens_in:95000,  tokens_out:48000,  sessions:41, last_active:ago(0.2) },
  { user:"maya.patel",     hostname:"LAPTOP-SEC01",    product:"Claude Desktop", tokens_in:45000,  tokens_out:22000,  sessions:18, last_active:ago(2) },
  { user:"emma.rodriguez", hostname:"MACBOOK-DESIGN",  product:"Claude Desktop", tokens_in:32000,  tokens_out:15000,  sessions:12, last_active:ago(4) },
  { user:"aisha.hassan",   hostname:"SERVER-ML01",     product:"Claude Code",    tokens_in:200000, tokens_out:110000, sessions:89, last_active:ago(0.1) },
  { user:"mikhail.petrov", hostname:"WORKSTATION-QA",  product:"Claude Desktop", tokens_in:28000,  tokens_out:14000,  sessions:10, last_active:ago(6) },
];

// ═══════════════════════════════════════════════════════════════════════════════
// AGENT GOVERNANCE mock discovery data
// ═══════════════════════════════════════════════════════════════════════════════
const govAgents = Array.from({length:67}, (_,i) => ({
  id:`ag-${i}`, name:["Case Management Agent","D365 Sales Agent","Email Validation Bot","Customer Service Bot","IT Help Desk Agent",
    "HR Onboarding Agent","Compliance Scanner","Data Migration Bot","Report Generator","Expense Approver",
    "Meeting Scheduler","Translation Bot","Code Review Agent","Security Audit Bot","Inventory Tracker"][i%15]+(i>=15?` (${Math.ceil((i+1)/15)})`:""),
  platform:i%3===0?"Reasoning Engine":i%3===1?"Agent Builder":"Copilot Studio",
  risk_score:Math.floor(Math.random()*80)+5, risk_level:["low","medium","medium","high","low","low","medium"][i%7],
  status:i%10===0?"suspended":"active", owner:["Erik E","Sarah C","Priya S","Raj G","Maya P","David K",null][i%7],
  last_activity:ago(Math.random()*720), invocations:Math.floor(Math.random()*500)+1,
  is_orphaned:i%7===6, consent_type:i%5===0?"AllPrincipals":"AdminConsented",
  has_http_connector:i%4===0, has_dangerous_permissions:i%8===0,
  connector_count:Math.floor(Math.random()*5), permission_count:Math.floor(Math.random()*15),
  unique_users:Math.floor(Math.random()*20)+1, days_since_last_activity:Math.floor(Math.random()*120),
}));

// ═══════════════════════════════════════════════════════════════════════════════
// ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

app.get("/api/v1/health", (_,r) => r.json({ok:true,service:"ai-governance-server",version:"0.1.0-demo",dbKind:"demo"}));
app.get("/api/v1/overview", (_,r) => r.json({totals:{machines:machines.length,unique_tools:aiSystems.length,findings:aiSystems.length*8,dlp_events:dlpEvents.length}}));
app.get("/api/v1/machines", (_,r) => r.json(machines));

// Registry
app.get("/api/v1/registry", (_,r) => r.json(aiSystems));
app.get("/api/v1/registry/summary", (_,r) => {
  const st={approved:0,restricted:0,blocked:0,unknown:0}, rk={low:0,medium:0,high:0,critical:0,not_assessed:0};
  for(const s of aiSystems){ st[s.status]=(st[s.status]||0)+1; rk[s.risk_level||"not_assessed"]=(rk[s.risk_level||"not_assessed"]||0)+1; }
  r.json({total_ai_systems:aiSystems.length,active_ai_systems:aiSystems.filter(s=>s.activity?.total>0).length,by_status:st,by_risk:rk,by_source:{governance_agents:8,endpoint_tools:24,platform_services:4}});
});
app.put("/api/v1/registry/:id/status", (q,r) => { const s=aiSystems.find(x=>x.id===q.params.id); if(s)s.status=q.body.status; r.json({ok:true}); });
app.get("/api/v1/ai-platforms", (_,r) => r.json(aiPlatforms));
app.patch("/api/v1/ai-platforms/:host", (_,r) => r.json({ok:true}));

// DLP
app.get("/api/v1/dlp", (q,r) => {
  let f=dlpEvents;
  if(q.query.severity){const s=new Set(q.query.severity.split(","));f=f.filter(e=>s.has(e.secret_class));}
  r.json(f.slice(0,parseInt(q.query.limit)||500));
});
app.get("/api/v1/dlp/summary", (_,r) => {
  const byS={},byV={},byK={};
  for(const e of dlpEvents){ byS[e.ai_service]=byS[e.ai_service]||{ai_service:e.ai_service,events:0,prompts:0,file_uploads:0,machines:0};byS[e.ai_service].events++;
    byV[e.secret_class]=byV[e.secret_class]||{severity:e.secret_class,events:0};byV[e.secret_class].events++;
    byK[e.event_kind]=byK[e.event_kind]||{event_kind:e.event_kind,events:0};byK[e.event_kind].events++; }
  r.json({byService:Object.values(byS),bySeverity:Object.values(byV),byKind:Object.values(byK),recentCritical:dlpEvents.filter(e=>e.secret_class==="critical").slice(0,15)});
});
app.get("/api/v1/dlp/files", (q,r) => r.json(dlpFiles.slice(0,parseInt(q.query.limit)||500)));
app.get("/api/v1/dlp/:id/content", (_,r) => r.type("text/plain").send("Demo content — this is a sample captured prompt.\n\nMy SSN is 123-45-6789 and my API key is sk-ant-api03-FAKE_KEY_FOR_DEMO.\nBearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.FAKE_TOKEN\n\nPlease help me analyze this data:\nEmployee: John Smith, Email: john.smith@company.com\nCredit Card: 4111-1111-1111-1111\nAWS Key: AKIAIOSFODNN7EXAMPLE"));

// Findings
app.get("/api/v1/findings", (q,r) => {
  if(q.query.type==="mcp_server") return r.json(mcpFindings);
  if(q.query.type==="agent_project") return r.json(agentFindings);
  r.json([]);
});

// Tools
app.get("/api/v1/tools", (_,r) => r.json(aiSystems.map(s=>({product:s.name,vendor:s.vendor,tool_key:s.id,sanction:s.status,machines:Math.floor(Math.random()*8)+1,evidence_types:["browser_visit","api_call","clipboard","file_upload"].slice(0,Math.floor(Math.random()*3)+1)}))));

// Policies
app.get("/api/policies", (_,r) => r.json(policies));
app.post("/api/policies", (q,r) => { const p={id:"pol-"+id(),...q.body,created_at:new Date().toISOString()};policies.push(p);r.json(p); });
app.put("/api/policies/:id", (q,r) => { const p=policies.find(x=>x.id===q.params.id);if(p)Object.assign(p,q.body);r.json(p||{error:"not found"}); });
app.delete("/api/policies/:id", (q,r) => { policies=policies.filter(x=>x.id!==q.params.id);r.json({ok:true}); });
app.post("/api/policies/simulate", (q,r) => {
  const pol=policies.find(p=>p.id===q.body.policy_id);
  const n=Math.floor(Math.random()*12);
  const names=["Case Management Agent","D365 Sales Agent","Email Validation Bot","Customer Service Bot","IT Help Desk Agent","HR Onboarding Agent","Compliance Scanner","Data Migration Bot","Report Generator","Expense Approver","Meeting Scheduler","Translation Bot"];
  r.json({policies:[{would_flag:n,severity:pol?.severity||"medium",actions:pol?.actions?.map(a=>a.type)||["flag"],
    matches:names.slice(0,Math.min(n,8)).map((nm,i)=>({agent_name:nm,condition_triggered:pol?.conditions?.[0]?`${pol.conditions[0].field} ${pol.conditions[0].operator} ${pol.conditions[0].value}`:"condition met",already_open:i===0})),
    newly_flagged:n,already_open:n>0?1:0}],agents_evaluated:67});
});
app.post("/api/policies/evaluate", (_,r) => r.json({totalViolations:8,totalAgents:67,bySeverity:{critical:2,high:3,medium:2,low:1},violations:[]}));
app.post("/api/policies/seed-templates", (_,r) => r.json({created:0}));

// Policy Packs
app.get("/api/policy-packs", (_,r) => r.json(policyPacks));
app.get("/api/policy-packs/:id", (q,r) => {
  const p=policyPacks.packs.find(x=>x.id===q.params.id);
  r.json(p?{...p,rules:Array.from({length:p.ruleCount},(_,i)=>({key:`rule-${i}`,title:`Rule ${i+1}: ${["Data minimization","Access control","Encryption at rest","Audit logging","Consent verification","Breach notification","Right to erasure","Data retention","Cross-border transfer","Risk assessment","Human oversight","Transparency obligation","Vendor oversight","Incident response","Change management"][i%15]}`,citation:`Article ${i+1}`,enforcement:i<p.enforceable?"agent":i<p.enforceable+p.monitored?"dlp":"attestation",severity:["high","medium","critical","low"][i%4],enabled:true}))}:{error:"not found"});
});
app.post("/api/policy-packs/:id/deploy", (q,r) => {
  const p=policyPacks.packs.find(x=>x.id===q.params.id);
  if(p){p.deployed=true;p.deployed_version=p.version;
    for(let i=0;i<p.enforceable;i++) policies.push({id:`${p.id}-rule-${i}`,name:`[${p.framework}] ${["Data minimization","Access control","Encryption enforcement","Audit trail","Consent gate","Breach alert","Erasure workflow"][i%7]}`,description:`Auto-enforced compliance rule from ${p.framework}`,type:"compliance",severity:["high","medium","critical","low"][i%4],status:"active",pack_id:p.id,conditions:[{field:"risk_score",operator:"greater_than",value:50+i*5}],actions:[{type:"flag"}],scope:{type:"all"}});
  }
  r.json({ok:true});
});
app.post("/api/policy-packs/:id/undeploy", (q,r) => {
  const p=policyPacks.packs.find(x=>x.id===q.params.id);
  if(p){p.deployed=false;p.deployed_version=null;policies=policies.filter(x=>x.pack_id!==p.id);}
  r.json({ok:true});
});

// Access Requests
app.get("/api/v1/access-requests", (_,r) => r.json(accessRequests));
app.put("/api/v1/access-requests/:id/approve", (q,r) => { const a=accessRequests.find(x=>x.id===q.params.id);if(a){a.status="approved";a.reviewed_at=new Date().toISOString();a.expires_at=new Date(Date.now()+24*3600000).toISOString();}r.json({ok:true}); });
app.put("/api/v1/access-requests/:id/reject", (q,r) => { const a=accessRequests.find(x=>x.id===q.params.id);if(a){a.status="rejected";a.reviewed_at=new Date().toISOString();}r.json({ok:true}); });
app.get("/api/v1/access-exceptions", (_,r) => r.json(accessExceptions));
app.delete("/api/v1/access-exceptions/:id", (_,r) => r.json({ok:true}));

// Risk Scores
app.get("/api/v1/risk-scores", (_,r) => r.json(riskScores));
app.get("/api/v1/risk-scores/summary", (_,r) => {
  const low=riskScores.filter(s=>s.risk_score<=30).length, med=riskScores.filter(s=>s.risk_score>30&&s.risk_score<=60).length;
  const hi=riskScores.filter(s=>s.risk_score>60&&s.risk_score<=80).length, crit=riskScores.filter(s=>s.risk_score>80).length;
  const avg=Math.round(riskScores.reduce((s,x)=>s+x.risk_score,0)/riskScores.length);
  r.json({total_employees:riskScores.length,average_score:avg,average_level:avg>60?"high":avg>30?"medium":"low",distribution:{low,medium:med,high:hi,critical:crit}});
});
app.get("/api/v1/risk-scores/:id", (q,r) => {
  const s=riskScores.find(x=>x.id===q.params.id);
  r.json(s?{...s,history:[{score:s.risk_score-5,date:ago(168)},{score:s.risk_score-2,date:ago(72)},{score:s.risk_score,date:ago(1)}],recent_events:dlpEvents.filter(e=>e.machine_id===s.machine_id).slice(0,5)}:{error:"not found"});
});
app.post("/api/v1/risk-scores/compute", (_,r) => r.json({ok:true,computed:riskScores.length}));
app.post("/api/v1/identity/resolve", (_,r) => r.json({ok:true,total_profiles:machines.length,created:0,updated:machines.length}));

// Webhooks & Connections
app.get("/api/v1/webhooks", (_,r) => r.json(webhooks));
app.get("/api/v1/webhooks/templates", (_,r) => r.json({templates:[{id:"slack",name:"Slack"},{id:"teams",name:"Teams"},{id:"jira",name:"Jira"},{id:"custom",name:"Custom"}],triggers:["dlp_critical","risk_score_high","access_request","tool_blocked","tool_approved"]}));
app.get("/api/v1/webhooks/log", (_,r) => r.json(Array.from({length:20},(_,i)=>({id:"log-"+i,webhook_id:webhooks[i%webhooks.length].id,webhook_name:webhooks[i%webhooks.length].name,trigger:["dlp_critical","risk_score_high","tool_blocked"][i%3],status:i%5===0?"failed":"delivered",response_code:i%5===0?500:200,delivered_at:ago(Math.random()*168)}))));
app.post("/api/v1/webhooks", (q,r) => r.json({id:"wh-"+id(),...q.body}));
app.put("/api/v1/webhooks/:id", (_,r) => r.json({ok:true}));
app.delete("/api/v1/webhooks/:id", (_,r) => r.json({ok:true}));
app.post("/api/v1/webhooks/:id/test", (_,r) => r.json({ok:true}));
app.get("/api/v1/connections", (_,r) => r.json(connections));
app.post("/api/v1/connections/:type", (_,r) => r.json({ok:true}));
app.delete("/api/v1/connections/:type", (_,r) => r.json({ok:true}));
app.get("/api/v1/connections/:type/channels", (_,r) => r.json({channels:[{id:"C001",name:"general"},{id:"C002",name:"security-alerts"},{id:"C003",name:"ai-governance"},{id:"C004",name:"compliance"},{id:"C005",name:"engineering"}]}));

// Claude Usage
app.get("/api/v1/claude-usage", (_,r) => r.json(claudeUsers));
app.get("/api/v1/claude-usage/summary", (_,r) => r.json({total_users:claudeUsers.length,active_today:4,total_tokens:claudeUsers.reduce((s,u)=>s+u.tokens_in+u.tokens_out,0),by_product:[{product:"Claude Code",users:4,tokens:665000},{product:"Claude Desktop",users:3,tokens:156000}]}));

// Server Agents
app.get("/api/v1/server-agent-events", (_,r) => r.json([]));
app.get("/api/v1/server-agent-events/summary", (_,r) => r.json({calls:156,cost:4.82,byUser:[{user:"api-service",calls:89,cost:2.45},{user:"batch-job",calls:67,cost:2.37}],byModel:[{model:"claude-sonnet-4",calls:120,cost:3.60},{model:"gpt-4o-mini",calls:36,cost:1.22}],byTrigger:[{trigger:"api",calls:120,cost:3.20},{trigger:"scheduled",calls:36,cost:1.62}],byProvider:[{provider:"anthropic",calls:120,cost:3.60},{provider:"openai",calls:36,cost:1.22}]}));

// Agent Governance
app.get("/api/agents/discover", (_,r) => r.json({agents:govAgents}));
app.get("/api/agents", (_,r) => r.json(govAgents));
app.get("/api/oauth-keys", (_,r) => r.json([]));
app.post("/api/agents/discover", (_,r) => r.json({agents:govAgents}));
// This is what AgentGovernanceContext fetches on mount to populate discoveryStatus
app.get("/api/discovery/agents", (_,r) => r.json({agents:govAgents,warnings:[]}));

// Installations / SDK
app.get("/api/v1/sdk/download", (_,r) => r.status(200).send("demo-sdk.zip"));
app.get("/api/v1/installations", (_,r) => r.json([]));
app.get("/api/v1/installations/info", (_,r) => r.json({server_url:"https://demo.cloudfuze.com",enroll_secret:"DEMO-SECRET-123",version:"1.0.0"}));
app.get("/api/v1/installations/agent-installer", (_,r) => r.status(200).send("demo-installer"));
app.get("/api/v1/installations/extension-package", (_,r) => r.status(200).send("demo-extension"));
app.get("/api/v1/installations/claude-tracker", (_,r) => r.status(200).send("demo-tracker"));

// Catch-all
app.all("/api/*", (q,r) => { console.log(`[demo] unhandled: ${q.method} ${q.path}`); r.json({ok:true}); });

const PORT = 8788;
app.listen(PORT, () => console.log(`Demo mock API on http://localhost:${PORT} — ${aiSystems.length} AI systems, ${machines.length} machines, ${dlpEvents.length+dlpFiles.length} DLP events, ${policies.length} policies, ${govAgents.length} agents`));
