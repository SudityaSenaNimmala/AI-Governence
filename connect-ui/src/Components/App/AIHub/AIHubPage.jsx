import { useState, useEffect } from "react";
import SideNav from "../../Resuables/Nav/SideNav";
import TopNav from "../../Resuables/Nav/TopNav";
import AgentGovernance from "../AgentGovernance/AgentGovernance";
import {
  Monitor, Scan, AlertTriangle, Wrench, Server, Shield, Clock, ChevronRight,
  Search, RefreshCw, Activity, FileText, MessageSquare, Eye, Trash2, Plus, X,
} from "lucide-react";
import "./AIHub.css";

const API = "http://localhost:8787/api/v1";
async function apiFetch(path) {
  const r = await fetch(`${API}${path}`);
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
}
function relTime(d) {
  if (!d) return "—";
  const ms = Date.now() - new Date(d).getTime();
  if (ms < 60000) return "just now";
  if (ms < 3600000) return `${Math.floor(ms/60000)}m ago`;
  if (ms < 86400000) return `${Math.floor(ms/3600000)}h ago`;
  return `${Math.floor(ms/86400000)}d ago`;
}
function fmtUsd(n) { return "$" + (n||0).toFixed(2); }
function fmtTokens(n) { if (!n) return "—"; if (n>1e6) return (n/1e6).toFixed(1)+"M"; if (n>1e3) return (n/1e3).toFixed(1)+"K"; return n; }

// ── Shared UI ────────────────────────────────────────────────────────────────
function StatCard({ icon, label, value, hint, color="#0044cc" }) {
  return (<div className="aihub_stat_card"><div className="aihub_stat_icon" style={{background:color+"12",color}}>{icon}</div><div><div className="aihub_stat_value">{typeof value==="number"?value.toLocaleString():value}</div><div className="aihub_stat_label">{label}</div>{hint&&<div className="aihub_stat_sub">{hint}</div>}</div></div>);
}
function SectionHeader({ title, hint, action }) {
  return (<div className="aihub_section_header"><div><h3 className="aihub_section_title">{title}</h3>{hint&&<p className="aihub_section_subtitle">{hint}</p>}</div>{action}</div>);
}
function Badge({ text, color="#6b7280" }) {
  return <span className="aihub_badge" style={{background:color+"14",color,borderColor:color+"30"}}>{text}</span>;
}
function RiskBadge({ score }) { if(score==null) return <span className="aihub_text_muted">—</span>; const c=score>=70?"#ef4444":score>=40?"#f59e0b":"#22c55e"; return <Badge text={score} color={c}/>; }
function SanctionBadge({ status }) { const c={approved:"#22c55e",restricted:"#f59e0b",blocked:"#ef4444",unknown:"#9ca3af"}; return <Badge text={status||"unknown"} color={c[status]||c.unknown}/>; }
function SeverityBadge({ sev }) { const c={critical:"#ef4444",high:"#f59e0b",medium:"#3b82f6",low:"#22c55e"}; return <Badge text={sev||"—"} color={c[sev]||"#9ca3af"}/>; }
function Mono({ children }) { return <span className="aihub_text_mono">{children}</span>; }
function Tag({ text, color="#6366f1" }) { return <span style={{display:"inline-block",padding:"1px 6px",borderRadius:4,fontSize:10,fontWeight:600,background:color+"14",color,marginRight:3,marginBottom:2}}>{text}</span>; }
function Loading() { return <div className="aihub_loading"><RefreshCw size={18} className="aihub_spin"/> Loading...</div>; }
function Err({msg}) { return <div className="aihub_error"><AlertTriangle size={14}/> {msg}</div>; }
function Empty({icon,title,msg}) { return <div className="aihub_empty">{icon}<h4>{title}</h4><p>{msg}</p></div>; }
function DataTable({ columns, rows, empty, onRow }) {
  return (<div className="aihub_table_wrap"><table className="aihub_table"><thead><tr>{columns.map((c,i)=><th key={i} style={c.right?{textAlign:"right"}:undefined}>{c.label}</th>)}</tr></thead><tbody>{(!rows||!rows.length)?<tr><td colSpan={columns.length} className="aihub_table_empty">{empty||"No data"}</td></tr>:rows.map((r,i)=><tr key={r.id||r.tool_key||i} onClick={()=>onRow?.(r)} style={{cursor:onRow?"pointer":"default"}}>{columns.map((c,j)=><td key={j} style={c.right?{textAlign:"right"}:undefined}>{c.render?c.render(r):r[c.key]??"—"}</td>)}</tr>)}</tbody></table></div>);
}
function BarChart({ data, lk, vk, max=8 }) {
  const items=(data||[]).slice(0,max); const mx=Math.max(1,...items.map(d=>d[vk]||0));
  return (<div className="aihub_bar_chart">{items.map((d,i)=>(<div key={i} className="aihub_bar_row"><div className="aihub_bar_label">{(d[lk]||"").replace(/_/g," ")}</div><div className="aihub_bar_track"><div className="aihub_bar_fill" style={{width:`${(d[vk]/mx)*100}%`}}/></div><div className="aihub_bar_value">{d[vk]?.toLocaleString()}</div></div>))}</div>);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. OVERVIEW
// ═══════════════════════════════════════════════════════════════════════════════
function OverviewView() {
  const [d,setD]=useState(null),[e,setE]=useState(null);
  useEffect(()=>{apiFetch("/overview").then(setD).catch(x=>setE(x.message))},[]);
  if(e) return <Err msg={e}/>; if(!d) return <Loading/>;
  return (<div>
    <SectionHeader title="Overview" hint="Aggregate AI tool and agent footprint across enrolled machines."/>
    <div className="aihub_stat_grid">
      <StatCard icon={<Monitor size={18}/>} label="Enrolled machines" value={d.totals.machines} color="#0044cc"/>
      <StatCard icon={<Scan size={18}/>} label="Total scans" value={d.totals.scans} color="#0891b2"/>
      <StatCard icon={<AlertTriangle size={18}/>} label="Findings" value={d.totals.findings} color="#f59e0b"/>
      <StatCard icon={<Wrench size={18}/>} label="Unique AI tools" value={d.totals.unique_tools} color="#8b5cf6"/>
    </div>
    <div className="aihub_two_col">
      <div className="aihub_card">
        <SectionHeader title="Top AI tools across the org" hint="Most-detected tools, ranked by machine count."/>
        <DataTable columns={[
          {label:"Product",render:r=><><div className="aihub_text_primary">{r.product||"—"}</div><div className="aihub_text_muted">{r.vendor||"Unknown"}</div></>},
          {label:"Machines",key:"machines",right:true},
          {label:"Findings",key:"findings",right:true},
          {label:"Status",render:r=><SanctionBadge status={r.sanction}/>},
        ]} rows={d.topTools||[]}/>
      </div>
      <div className="aihub_card">
        <SectionHeader title="Findings breakdown" hint="Distribution of finding categories."/>
        <BarChart data={d.byType} lk="type" vk="count"/>
      </div>
    </div>
  </div>);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 2. MACHINES
// ═══════════════════════════════════════════════════════════════════════════════
function MachinesView() {
  const [rows,setRows]=useState(null),[e,setE]=useState(null),[q,setQ]=useState("");
  useEffect(()=>{apiFetch("/machines").then(setRows).catch(x=>setE(x.message))},[]);
  if(e) return <Err msg={e}/>; if(!rows) return <Loading/>;
  const platTone={win32:"#0044cc",darwin:"#6b7280",linux:"#f59e0b"};
  const filtered=q?rows.filter(r=>[r.hostname,r.user,r.platform].join(" ").toLowerCase().includes(q.toLowerCase())):rows;
  return (<div>
    <SectionHeader title="Enrolled machines" hint={`${filtered.length} of ${rows.length} machines`} action={<div className="aihub_search_box"><Search size={14}/><input placeholder="Search hostname, user, OS..." value={q} onChange={e=>setQ(e.target.value)}/></div>}/>
    <div className="aihub_card">
      <DataTable columns={[
        {label:"Machine",render:r=><><div className="aihub_text_primary">{r.hostname||r.id?.slice(0,12)}</div><div className="aihub_text_muted">{r.user}</div></>},
        {label:"Platform",render:r=><Badge text={r.platform} color={platTone[r.platform]||"#6b7280"}/>},
        {label:"Findings",key:"findings_count",right:true},
        {label:"Tools",key:"unique_tools",right:true},
        {label:"Last scan",render:r=>relTime(r.last_scan_at)},
      ]} rows={filtered}/>
    </div>
  </div>);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 3. TOOLS CATALOG
// ═══════════════════════════════════════════════════════════════════════════════
function ToolsView() {
  const [rows,setRows]=useState(null),[e,setE]=useState(null),[q,setQ]=useState(""),[status,setStatus]=useState("all");
  useEffect(()=>{apiFetch("/tools").then(setRows).catch(x=>setE(x.message))},[]);
  if(e) return <Err msg={e}/>; if(!rows) return <Loading/>;
  const filtered=rows.filter(r=>{
    if(status!=="all"&&r.sanction!==status) return false;
    if(q&&![r.product,r.vendor,r.tool_key].join(" ").toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  });
  const tabs=["all","approved","restricted","blocked","unknown"];
  return (<div>
    <SectionHeader title="Tools catalog" hint={`${filtered.length} tools`} action={<div className="aihub_search_box"><Search size={14}/><input placeholder="Filter by vendor or product..." value={q} onChange={e=>setQ(e.target.value)}/></div>}/>
    <div style={{display:"flex",gap:6,marginBottom:14}}>
      {tabs.map(t=><button key={t} className={`aihub_filter_btn ${status===t?"active":""}`} onClick={()=>setStatus(t)}>{t}</button>)}
    </div>
    <div className="aihub_card">
      <DataTable columns={[
        {label:"Product",render:r=><><div className="aihub_text_primary">{r.product||r.tool_key}</div><div className="aihub_text_muted">{r.vendor||"Unknown"}</div></>},
        {label:"Evidence",render:r=><div style={{display:"flex",flexWrap:"wrap",gap:2}}>{(r.evidence_types||[]).slice(0,4).map((t,i)=><Tag key={i} text={t.replace(/_/g," ")}/>)}{(r.evidence_types||[]).length>4&&<Tag text={`+${r.evidence_types.length-4}`} color="#9ca3af"/>}</div>},
        {label:"Machines",key:"machines",right:true},
        {label:"Status",render:r=><SanctionBadge status={r.sanction}/>},
      ]} rows={filtered}/>
    </div>
  </div>);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 4. AGENTS & MCP
// ═══════════════════════════════════════════════════════════════════════════════
function AgentsView() {
  const [mcp,setMcp]=useState(null),[projects,setProjects]=useState(null),[configs,setConfigs]=useState(null),[hooks,setHooks]=useState(null),[e,setE]=useState(null);
  useEffect(()=>{
    Promise.all([
      apiFetch("/findings?type=mcp_server&latestOnly=true&limit=500"),
      apiFetch("/findings?type=agent_project&latestOnly=true&limit=500"),
      apiFetch("/findings?type=agent_config&latestOnly=true&limit=500"),
      apiFetch("/findings?type=desktop_hook_status&latestOnly=true&limit=500"),
    ]).then(([m,p,c,h])=>{setMcp(m);setProjects(p);setConfigs(c);setHooks(h)}).catch(x=>setE(x.message));
  },[]);
  if(e) return <Err msg={e}/>; if(!mcp) return <Loading/>;

  const catMap={ai_agent:{title:"Autonomous AI agents",hint:"Projects using agent frameworks (LangChain, AutoGen, CrewAI, LlamaIndex, MCP SDK)",color:"#ef4444"},ai_coding_agent:{title:"AI coding agents",hint:"Projects managed by Claude Code, Cursor, Aider, Continue",color:"#f59e0b"},ai_app:{title:"AI-using apps",hint:"Projects that call LLM APIs",color:"#0044cc"}};
  const grouped={ai_agent:[],ai_coding_agent:[],ai_app:[]};
  (projects||[]).forEach(f=>{const c=f.payload?.primaryCategory||"ai_app";(grouped[c]||(grouped[c]=[])).push(f)});

  const hookTone={injected:"#22c55e",already_injected:"#22c55e",failed:"#ef4444",pending:"#f59e0b"};

  return (<div>
    <SectionHeader title="Agents & MCP" hint="AI agent projects, MCP servers, desktop hooks, and agent configs across all machines."/>

    {/* MCP Servers */}
    <div className="aihub_card">
      <SectionHeader title="MCP servers in use" hint="Each MCP server is a capability granted to an AI agent."/>
      <DataTable columns={[
        {label:"Machine",render:r=><Mono>{(r.machine_id||"").slice(0,10)}</Mono>},
        {label:"Client",render:r=>r.payload?.client||"—"},
        {label:"Server",render:r=><span className="aihub_text_primary">{r.payload?.serverName||"—"}</span>},
        {label:"Scopes",render:r=><div style={{display:"flex",flexWrap:"wrap",gap:2}}>{(r.payload?.scopes||[]).map((s,i)=><Tag key={i} text={s}/>)}</div>},
        {label:"Command",render:r=><Mono>{[r.payload?.command,...(r.payload?.args||[])].filter(Boolean).join(" ").slice(0,60)}</Mono>},
      ]} rows={mcp} empty="No MCP servers found"/>
    </div>

    {/* Agent project categories */}
    {Object.entries(catMap).map(([cat,cfg])=>(
      <div className="aihub_card" key={cat}>
        <SectionHeader title={cfg.title} hint={cfg.hint}/>
        <DataTable columns={[
          {label:"Machine",render:r=><Mono>{(r.machine_id||"").slice(0,10)}</Mono>},
          {label:"Path",render:r=><Mono>{r.payload?.path||"—"}</Mono>},
          {label:"Language",render:r=>r.payload?.language||"—"},
          {label:"Frameworks",render:r=><div style={{display:"flex",flexWrap:"wrap",gap:2}}>{(r.payload?.frameworks||[]).map((f,i)=><Tag key={i} text={f} color={cfg.color}/>)}</div>},
          {label:"Modified",render:r=>relTime(r.payload?.lastModified)},
        ]} rows={grouped[cat]||[]} empty={`No ${cfg.title.toLowerCase()} found`}/>
      </div>
    ))}

    {/* Desktop hooks */}
    <div className="aihub_card">
      <SectionHeader title="Desktop hook coverage" hint="Whether the endpoint agent has injected the in-app monitoring hook into Electron AI apps."/>
      <DataTable columns={[
        {label:"Machine",render:r=><Mono>{(r.machine_id||"").slice(0,10)}</Mono>},
        {label:"Product",render:r=><><span className="aihub_text_primary">{r.payload?.product||"—"}</span> <span className="aihub_text_muted">{r.payload?.vendor||""}</span></>},
        {label:"Version",render:r=><><span>{r.payload?.appVersion||"—"}</span> <span className="aihub_text_muted">hook {r.payload?.hookVersion||"?"}</span></>},
        {label:"Status",render:r=><Badge text={r.payload?.hookStatus||"unknown"} color={hookTone[r.payload?.hookStatus]||"#9ca3af"}/>},
        {label:"Injected",render:r=>relTime(r.payload?.injectedAt)},
      ]} rows={hooks||[]} empty="No desktop hooks found"/>
    </div>

    {/* Agent configs */}
    <div className="aihub_card">
      <SectionHeader title="Agent configurations" hint="Machine-level config files that grant capabilities to AI agents."/>
      <DataTable columns={[
        {label:"Machine",render:r=><Mono>{(r.machine_id||"").slice(0,10)}</Mono>},
        {label:"Kind",render:r=>r.payload?.kind||"—"},
        {label:"Vendor",render:r=>r.payload?.vendor||"—"},
        {label:"Path",render:r=><Mono>{r.payload?.path||"—"}</Mono>},
        {label:"Modified",render:r=>relTime(r.payload?.lastModified)},
      ]} rows={configs||[]} empty="No agent configs found"/>
    </div>
  </div>);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 5. SERVER AGENTS
// ═══════════════════════════════════════════════════════════════════════════════
function ServerAgentsView() {
  const [summary,setS]=useState(null),[calls,setC]=useState(null),[e,setE]=useState(null);
  useEffect(()=>{
    Promise.all([apiFetch("/server-agents/summary").catch(()=>null),apiFetch("/server-agents/calls?limit=200").catch(()=>[])]).then(([s,c])=>{setS(s);setC(c)}).catch(x=>setE(x.message));
  },[]);
  if(e) return <Err msg={e}/>; if(summary===null&&calls===null) return <Loading/>;
  if(!summary?.totals) return <div className="aihub_card"><Empty icon={<Server size={32} strokeWidth={1.5}/>} title="No Server Agent Data" msg="Install the server-monitor daemon on a Linux server to capture LLM API calls."/></div>;

  const triggerTone={interactive_shell:"#0044cc",cron:"#8b5cf6",systemd:"#0891b2",ssh:"#f59e0b",ci:"#22c55e",container:"#6366f1",login:"#9ca3af"};
  const providerTone={openai:"#10a37f",anthropic:"#d4622a",google:"#4285f4","openai-azure":"#0078d4","aws-bedrock":"#ff9900"};

  return (<div>
    <SectionHeader title="Server Agents" hint="LLM API calls intercepted from backend servers."/>
    <div className="aihub_stat_grid">
      <StatCard icon={<Activity size={18}/>} label="Calls observed" value={summary.totals.calls||0} color="#0044cc"/>
      <StatCard icon={<Wrench size={18}/>} label="Total cost (USD)" value={fmtUsd(summary.totals.total_cost_usd)} color="#22c55e"/>
      <StatCard icon={<Monitor size={18}/>} label="Distinct users" value={summary.totals.distinct_users||0} color="#8b5cf6"/>
      <StatCard icon={<Server size={18}/>} label="Distinct machines" value={summary.totals.distinct_machines||0} color="#f59e0b"/>
    </div>
    <div className="aihub_two_col">
      <div className="aihub_card"><SectionHeader title="Cost by user"/><DataTable columns={[{label:"User",key:"user"},{label:"Calls",key:"calls",right:true},{label:"Cost",render:r=>fmtUsd(r.cost),right:true}]} rows={summary.byUser||[]}/></div>
      <div className="aihub_card"><SectionHeader title="Cost by model"/><DataTable columns={[{label:"Model",render:r=><Mono>{r.model}</Mono>},{label:"Calls",key:"calls",right:true},{label:"Cost",render:r=>fmtUsd(r.cost),right:true}]} rows={summary.byModel||[]}/></div>
    </div>
    <div className="aihub_two_col">
      <div className="aihub_card"><SectionHeader title="Trigger source"/><DataTable columns={[{label:"Source",render:r=><Badge text={r.trigger} color={triggerTone[r.trigger]||"#9ca3af"}/>},{label:"Calls",key:"calls",right:true},{label:"Cost",render:r=>fmtUsd(r.cost),right:true}]} rows={summary.byTrigger||[]}/></div>
      <div className="aihub_card"><SectionHeader title="By provider"/><DataTable columns={[{label:"Provider",render:r=><Badge text={r.provider} color={providerTone[r.provider]||"#9ca3af"}/>},{label:"Calls",key:"calls",right:true},{label:"Cost",render:r=>fmtUsd(r.cost),right:true}]} rows={summary.byProvider||[]}/></div>
    </div>
    <div className="aihub_card">
      <SectionHeader title="Recent calls"/>
      <DataTable columns={[
        {label:"When",render:r=>relTime(r.occurred_at)},
        {label:"User",render:r=>r.user||"—"},
        {label:"Trigger",render:r=><Badge text={r.trigger} color={triggerTone[r.trigger]||"#9ca3af"}/>},
        {label:"Agent",render:r=><Mono>{(r.cmdline||"").slice(0,60)}</Mono>},
        {label:"Provider",render:r=><Badge text={r.provider} color={providerTone[r.provider]||"#9ca3af"}/>},
        {label:"Model",render:r=><Mono>{r.model||"—"}</Mono>},
        {label:"Tokens",render:r=>fmtTokens(r.total_tokens),right:true},
        {label:"Cost",render:r=>fmtUsd(r.estimated_cost_usd),right:true},
      ]} rows={calls||[]}/>
    </div>
  </div>);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 6. DLP / AI ACTIVITY
// ═══════════════════════════════════════════════════════════════════════════════
function DLPView() {
  const [summary,setS]=useState(null),[events,setEv]=useState(null),[files,setF]=useState(null),[e,setE]=useState(null);
  useEffect(()=>{
    Promise.all([apiFetch("/dlp/summary").catch(()=>null),apiFetch("/dlp?limit=200").catch(()=>[]),apiFetch("/dlp/files").catch(()=>[])]).then(([s,ev,f])=>{setS(s);setEv(ev);setF(f)}).catch(x=>setE(x.message));
  },[]);
  if(e) return <Err msg={e}/>; if(!events) return <Loading/>;

  const promptCount=(summary?.byKind||[]).filter(k=>k.kind!=="file_upload").reduce((s,k)=>s+k.count,0);
  const fileCount=(summary?.byKind||[]).filter(k=>k.kind==="file_upload").reduce((s,k)=>s+k.count,0);
  const highCrit=(summary?.bySeverity||[]).filter(s=>s.severity==="critical"||s.severity==="high").reduce((s,k)=>s+k.count,0);
  const sourceTone={browser_extension:"#0044cc",desktop_hook:"#8b5cf6",os_monitor:"#f59e0b"};

  return (<div>
    <SectionHeader title="AI Activity (DLP)" hint="Clipboard, typed prompts, and file upload events captured by the OS monitor and browser extension."/>
    <div className="aihub_stat_grid" style={{gridTemplateColumns:"repeat(3,1fr)"}}>
      <StatCard icon={<MessageSquare size={18}/>} label="Prompt events" value={promptCount} hint="paste + submit" color="#0044cc"/>
      <StatCard icon={<FileText size={18}/>} label="File uploads" value={fileCount} hint="picker + drop + clipboard" color="#f59e0b"/>
      <StatCard icon={<AlertTriangle size={18}/>} label="High / critical" value={highCrit} hint="needs review" color="#ef4444"/>
    </div>

    {summary?.byService?.length>0&&<div className="aihub_card">
      <SectionHeader title="Activity by AI service"/>
      <DataTable columns={[
        {label:"Service",key:"ai_service"},
        {label:"Prompts",key:"prompts",right:true},
        {label:"File uploads",key:"file_uploads",right:true},
        {label:"Total",key:"events",right:true},
        {label:"Machines",key:"machines",right:true},
      ]} rows={summary.byService||[]}/>
    </div>}

    <div className="aihub_card">
      <SectionHeader title="Sensitive prompts"/>
      <DataTable columns={[
        {label:"When",render:r=>relTime(r.occurred_at)},
        {label:"Service",render:r=><span className="aihub_text_primary">{r.ai_service}</span>},
        {label:"Source",render:r=><Badge text={(r.source||"").replace(/_/g," ")} color={sourceTone[r.source]||"#9ca3af"}/>},
        {label:"Kind",render:r=><Tag text={r.event_kind}/>},
        {label:"Pattern",render:r=><Mono>{r.pattern_matched||"—"}</Mono>},
        {label:"Severity",render:r=><SeverityBadge sev={r.secret_class||r.highest_severity}/>},
        {label:"Length",render:r=>r.content_length||"—",right:true},
      ]} rows={(events||[]).filter(e=>e.event_kind!=="file_upload")} empty="No sensitive prompt events yet."/>
    </div>

    <div className="aihub_card">
      <SectionHeader title="File uploads"/>
      <DataTable columns={[
        {label:"When",render:r=>relTime(r.occurred_at)},
        {label:"Service",render:r=><span className="aihub_text_primary">{r.ai_service}</span>},
        {label:"Filename",render:r=><Mono>{r.metadata?.filename||"—"}</Mono>},
        {label:"Class",render:r=><Tag text={r.file_class||"—"}/>},
        {label:"Severity",render:r=><SeverityBadge sev={r.severity||r.highest_severity}/>},
        {label:"Size",render:r=>r.metadata?.size_bucket||"—",right:true},
        {label:"Via",render:r=><Badge text={r.metadata?.via||"—"}/>},
      ]} rows={files||[]} empty="No file upload events yet."/>
    </div>
  </div>);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 7. AI PLATFORMS
// ═══════════════════════════════════════════════════════════════════════════════
function PlatformsView() {
  const [rows,setRows]=useState(null),[e,setE]=useState(null),[q,setQ]=useState("");
  useEffect(()=>{apiFetch("/ai-platforms").then(setRows).catch(x=>setE(x.message))},[]);
  if(e) return <Err msg={e}/>; if(!rows) return <Loading/>;

  const governed=rows.filter(r=>r.governed).length;
  const adminAdded=rows.filter(r=>r.source==="admin").length;
  const llmDisc=rows.filter(r=>r.source==="classifier").length;
  const riskC={critical:"#ef4444",high:"#f59e0b",medium:"#3b82f6",low:"#22c55e"};
  const surfaceC={browser:"#0044cc",desktop:"#8b5cf6",cli:"#f59e0b",all:"#22c55e"};
  const filtered=q?rows.filter(r=>[r.host,r.vendor,r.product,r.category].join(" ").toLowerCase().includes(q.toLowerCase())):rows;

  return (<div>
    <SectionHeader title="AI Platforms" hint="Registry of known AI platforms used by the organization."/>
    <div className="aihub_stat_grid">
      <StatCard icon={<Server size={18}/>} label="Total" value={rows.length} color="#0044cc"/>
      <StatCard icon={<Shield size={18}/>} label="Governed" value={governed} color="#22c55e"/>
      <StatCard icon={<Plus size={18}/>} label="Admin-added" value={adminAdded} color="#8b5cf6"/>
      <StatCard icon={<Scan size={18}/>} label="LLM-discovered" value={llmDisc} color="#f59e0b"/>
    </div>
    <SectionHeader title="AI Platforms registry" action={<div className="aihub_search_box"><Search size={14}/><input placeholder="Filter by host, vendor, product..." value={q} onChange={e=>setQ(e.target.value)}/></div>}/>
    <div className="aihub_card">
      <DataTable columns={[
        {label:"Host",render:r=><Mono>{r.host}</Mono>},
        {label:"Vendor",render:r=>r.vendor||"—"},
        {label:"Product",render:r=>r.product||"—"},
        {label:"Category",render:r=>r.category?<Badge text={r.category} color="#6366f1"/>:<span className="aihub_text_muted">—</span>},
        {label:"Sandbox",render:r=>r.sandbox?<Badge text={r.sandbox}/>:<span className="aihub_text_muted">—</span>},
        {label:"Surface",render:r=>r.surface?<Badge text={r.surface} color={surfaceC[r.surface]||"#9ca3af"}/>:<span className="aihub_text_muted">—</span>},
        {label:"Governed",render:r=><Badge text={r.governed?"on":"off"} color={r.governed?"#22c55e":"#9ca3af"}/>,right:true},
        {label:"Source",render:r=><Badge text={r.source||"—"}/>},
        {label:"Updated",render:r=>relTime(r.updated_at)},
      ]} rows={filtered}/>
    </div>
  </div>);
}

// ═══════════════════════════════════════════════════════════════════════════════
// PAGE ROUTER
// ═══════════════════════════════════════════════════════════════════════════════
const PAGES={
  Overview:{title:"AI Overview",component:OverviewView},
  Machines:{title:"Machines",component:MachinesView},
  Tools:{title:"Tools Catalog",component:ToolsView},
  Agents:{title:"Agents & MCP",component:AgentsView},
  ServerAgents:{title:"Server Agents",component:ServerAgentsView},
  DLP:{title:"AI Activity",component:DLPView},
  Platforms:{title:"AI Platforms",component:PlatformsView},
  AgentGovernance:{title:"Agent Governance",component:AgentGovernance},
};

export default function AIHubPage({page}) {
  const config=PAGES[page]||PAGES.Overview;
  const V=config.component;
  return (
    <div className="cf_main_container">
      <SideNav activeTab="AI Hub"/>
      <div className="cf_main_content_place">
        <TopNav pageName={config.title}/>
        <div className="cf_main_content_place_main" style={{flexDirection:"column",padding:"16px 20px",overflowY:"auto"}}>
          <V/>
        </div>
      </div>
    </div>
  );
}
