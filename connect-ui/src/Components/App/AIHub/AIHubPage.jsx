import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import SideNav from "../../Resuables/Nav/SideNav";
import TopNav from "../../Resuables/Nav/TopNav";
import AgentGovernance from "../AgentGovernance/AgentGovernance";
import { AgentGovernanceProvider } from "../AgentGovernance/AgentGovernanceContext";
import { BudgetTab } from "../AgentGovernance/tabs/BudgetTab";
import {
  Monitor, Scan, AlertTriangle, Wrench, Server, Shield, Clock, ChevronRight,
  Search, RefreshCw, Activity, FileText, MessageSquare, Eye, Trash2, Plus, X,
} from "lucide-react";
import "./AIHub.css";

const API = "/api/v1";
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

// Only surface the severities that matter to a reviewer.
const HI_CRIT = new Set(["critical", "high"]);
function isHiCrit(sev) { return HI_CRIT.has(String(sev||"").toLowerCase()); }
// Prefer the resolved AI platform (e.g. "Gemini in Gmail" / Google) over the raw
// request host (e.g. "mail.google.com"), which is what the OS monitor records.
function ServiceCell({ row }) {
  const name = row.platform?.product || row.ai_service || "—";
  const vendor = row.platform?.vendor;
  return (<><div className="aihub_text_primary">{name}</div>{vendor && <div className="aihub_text_muted">{vendor}</div>}</>);
}

// ── Shared UI ────────────────────────────────────────────────────────────────
function StatCard({ icon, label, value, hint, color="#0044cc", onClick }) {
  return (<div className={`aihub_stat_card${onClick?" aihub_stat_card_clickable":""}`} onClick={onClick} style={onClick?{cursor:"pointer"}:undefined}><div className="aihub_stat_icon" style={{background:color+"12",color}}>{icon}</div><div><div className="aihub_stat_value">{typeof value==="number"?value.toLocaleString():value}</div><div className="aihub_stat_label">{label}</div>{hint&&<div className="aihub_stat_sub">{hint}</div>}</div>{onClick&&<div style={{marginLeft:"auto",color:"#9ca3af",display:"flex",alignItems:"center"}}><ChevronRight size={16}/></div>}</div>);
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

// View button — opens the captured prompt/file content for one DLP event.
// Only rendered when the server actually stored content for that event.
function ViewBtn({ has, onClick, label="View" }) {
  if (!has) return <span className="aihub_text_muted">—</span>;
  return (<button className="aihub_view_btn" onClick={e=>{e.stopPropagation();onClick();}}><Eye size={13}/> {label}</button>);
}
function classifyKind(ct) { if(ct.startsWith("image/")) return "image"; if(ct.startsWith("application/pdf")) return "pdf"; return "binary"; }

// Side drawer that fetches /dlp/:id/content and renders by Content-Type:
// text → highlighted block, image → <img>, pdf → <iframe>, else download link.
function ContentDrawer({ eventId, meta, onClose }) {
  const [state,setState]=useState({status:"loading"});
  const [url,setUrl]=useState(null);
  useEffect(()=>{
    let cancelled=false, revoke=null;
    (async()=>{
      setState({status:"loading"});
      try{
        const res=await fetch(`${API}/dlp/${eventId}/content`);
        if(!res.ok){ const b=await res.text().catch(()=>""); if(!cancelled) setState({status:"error",error:`${res.status}: ${b||res.statusText}`}); return; }
        const ct=res.headers.get("content-type")||"";
        const truncated=res.headers.get("x-content-truncated")==="1";
        if(ct.startsWith("text/")){
          const text=await res.text(); if(cancelled) return;
          setState({status:"ok",kind:"text",contentType:ct,text,truncated});
        } else {
          const blob=await res.blob(); if(cancelled) return;
          const u=URL.createObjectURL(blob); revoke=u; setUrl(u);
          setState({status:"ok",kind:classifyKind(ct),contentType:ct,truncated});
        }
      }catch(err){ if(!cancelled) setState({status:"error",error:err?.message||String(err)}); }
    })();
    return ()=>{ cancelled=true; if(revoke) URL.revokeObjectURL(revoke); };
  },[eventId]);
  useEffect(()=>{ const k=e=>{if(e.key==="Escape")onClose();}; window.addEventListener("keydown",k); return ()=>window.removeEventListener("keydown",k); },[onClose]);

  const filename=meta?.metadata?.filename;
  const title=filename || (String(meta?.event_kind||"").includes("prompt")?"Prompt content":"Captured content");
  const service=meta?.platform?.product||meta?.ai_service;
  const sev=meta?.secret_class||meta?.severity;
  return (
    <div className="aihub_drawer_overlay" onClick={onClose} role="dialog" aria-modal="true">
      <aside className="aihub_drawer" onClick={e=>e.stopPropagation()}>
        <header className="aihub_drawer_head">
          <div style={{minWidth:0}}>
            <div className="aihub_drawer_title">{title}</div>
            <div className="aihub_drawer_sub">{[service,meta?.event_kind,meta?.occurred_at&&relTime(meta.occurred_at)].filter(Boolean).join(" · ")}</div>
            <div style={{display:"flex",gap:6,marginTop:8,flexWrap:"wrap"}}>
              {meta?.source && <Badge text={(meta.source||"").replace(/_/g," ")}/>}
              {sev && <SeverityBadge sev={sev}/>}
              {state.truncated && <Badge text="truncated" color="#f59e0b"/>}
            </div>
          </div>
          <button className="aihub_drawer_close" onClick={onClose} title="Close (Esc)"><X size={16}/></button>
        </header>
        <div className="aihub_drawer_body">
          {state.status==="loading" && <div className="aihub_loading"><RefreshCw size={16} className="aihub_spin"/> Loading content…</div>}
          {state.status==="error" && <div style={{padding:16}}><div className="aihub_error"><AlertTriangle size={14}/> {state.error}</div><p className="aihub_text_muted" style={{fontSize:12,marginTop:10}}>Older events captured before content storage was enabled won't have a preview available.</p></div>}
          {state.status==="ok" && state.kind==="text" && <TextContent text={state.text} matches={meta?.metadata?.matches} contentType={state.contentType}/>}
          {state.status==="ok" && state.kind==="image" && <div style={{padding:16,display:"flex",justifyContent:"center",background:"#f9fafb",minHeight:"100%"}}><img src={url} alt={filename||""} style={{maxWidth:"100%",borderRadius:6}}/></div>}
          {state.status==="ok" && state.kind==="pdf" && <iframe src={url} title="PDF preview" style={{width:"100%",height:"100%",border:0}}/>}
          {state.status==="ok" && state.kind==="binary" && (
            <div style={{padding:28,textAlign:"center",display:"flex",flexDirection:"column",alignItems:"center"}}>
              <FileText size={28} strokeWidth={1.5}/>
              <div style={{marginTop:10,fontWeight:600,color:"#374151"}}>{filename||"Binary file"}</div>
              <div className="aihub_text_muted" style={{marginTop:4,fontSize:12}}>{state.contentType||"application/octet-stream"} · can't render inline</div>
              <a href={url} download={filename||"download.bin"} className="aihub_dl_btn">Download file</a>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

// Renders captured text with secret/PII patterns visually highlighted.
function TextContent({ text, matches, contentType }) {
  const HIGHLIGHTS=[
    {re:/sk-ant-[A-Za-z0-9_\-]{20,}/g}, {re:/sk-[A-Za-z0-9]{20,}/g},
    {re:/AKIA[0-9A-Z]{16}/g}, {re:/ghp_[A-Za-z0-9]{30,}/g},
    {re:/\b\d{3}-\d{2}-\d{4}\b/g}, {re:/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g},
    {re:/\b(?:\d[ -]?){13,19}\d\b/g}, {re:/[Bb]earer\s+[A-Za-z0-9\-._~+/]+=*/g},
  ];
  const spans=[];
  for(const h of HIGHLIGHTS){ h.re.lastIndex=0; let m; while((m=h.re.exec(text))!==null){ spans.push({start:m.index,end:m.index+m[0].length}); if(m.index===h.re.lastIndex) h.re.lastIndex++; } }
  spans.sort((a,b)=>a.start-b.start);
  const merged=[]; let cur=-1;
  for(const s of spans){ if(s.start<cur) continue; merged.push(s); cur=s.end; }
  const parts=[]; let idx=0;
  for(const s of merged){ if(s.start>idx) parts.push({text:text.slice(idx,s.start)}); parts.push({text:text.slice(s.start,s.end),hit:true}); idx=s.end; }
  if(idx<text.length) parts.push({text:text.slice(idx)});
  return (
    <div style={{padding:"16px 20px"}}>
      {Array.isArray(matches)&&matches.length>0 && (
        <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:12,alignItems:"center"}}>
          <span className="aihub_text_muted" style={{fontSize:11,fontWeight:600}}>Matched:</span>
          {matches.map((m,i)=><Badge key={i} text={`${m.pattern}${m.count>1?` ×${m.count}`:""}`} color="#ef4444"/>)}
        </div>
      )}
      <pre className="aihub_content_pre">{parts.map((p,i)=>p.hit?<mark key={i} className="aihub_content_mark">{p.text}</mark>:<span key={i}>{p.text}</span>)}</pre>
      <div className="aihub_text_muted" style={{marginTop:10,fontSize:11}}>{text.length.toLocaleString()} chars · {contentType}</div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. OVERVIEW
// ═══════════════════════════════════════════════════════════════════════════════
function OverviewView() {
  const [d,setD]=useState(null),[e,setE]=useState(null);
  const nav=useNavigate();
  useEffect(()=>{apiFetch("/overview").then(setD).catch(x=>setE(x.message))},[]);
  if(e) return <Err msg={e}/>; if(!d) return <Loading/>;
  return (<div>
    <SectionHeader title="Overview" hint="Aggregate AI tool and agent footprint across enrolled machines."/>
    <div className="aihub_stat_grid">
      <StatCard icon={<Monitor size={18}/>} label="Enrolled machines" value={d.totals.machines} color="#0044cc" onClick={()=>nav("/AIHub/Machines")}/>
      <StatCard icon={<Wrench size={18}/>} label="Unique AI tools" value={d.totals.unique_tools} color="#8b5cf6"/>
    </div>
    <div className="aihub_card">
      <SectionHeader title="Top AI tools across the org" hint="Most-detected tools, ranked by machine count."/>
      <DataTable columns={[
        {label:"Product",render:r=><><div className="aihub_text_primary">{r.product||"—"}</div><div className="aihub_text_muted">{r.vendor||"Unknown"}</div></>},
        {label:"Machines",key:"machines",right:true},
        {label:"Findings",key:"findings",right:true},
        {label:"Status",render:r=><SanctionBadge status={r.sanction}/>},
      ]} rows={(d.topTools||[]).filter(t=>t.product)} empty="No named AI tools detected yet."/>
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
        {label:"Config file",render:r=>r.payload?.configPath?<Mono title={r.payload.configPath}>{r.payload.configPath}</Mono>:<span className="aihub_text_muted">—</span>},
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
  const [preview,setPreview]=useState(null);   // event row whose content is open
  useEffect(()=>{
    Promise.all([apiFetch("/dlp/summary").catch(()=>null),apiFetch("/dlp?limit=200").catch(()=>[]),apiFetch("/dlp/files").catch(()=>[])]).then(([s,ev,f])=>{setS(s);setEv(ev);setF(f)}).catch(x=>setE(x.message));
  },[]);
  if(e) return <Err msg={e}/>; if(!events) return <Loading/>;

  // Server returns byKind as {event_kind, events} and bySeverity as {severity, events}.
  const promptCount=(summary?.byKind||[]).filter(k=>k.event_kind!=="file_upload").reduce((s,k)=>s+(k.events||0),0);
  const fileCount=(summary?.byKind||[]).filter(k=>k.event_kind==="file_upload").reduce((s,k)=>s+(k.events||0),0);
  const highCrit=(summary?.bySeverity||[]).filter(s=>s.severity==="critical"||s.severity==="high").reduce((s,k)=>s+(k.events||0),0);
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
      <SectionHeader title="Sensitive prompts" hint="High & critical severity only. Click View to see the captured prompt."/>
      <DataTable onRow={r=>{ if(r.has_content) setPreview(r); }} columns={[
        {label:"When",render:r=>relTime(r.occurred_at)},
        {label:"Service",render:r=><ServiceCell row={r}/>},
        {label:"Source",render:r=><Badge text={(r.source||"").replace(/_/g," ")} color={sourceTone[r.source]||"#9ca3af"}/>},
        {label:"Kind",render:r=><Tag text={r.event_kind}/>},
        {label:"Pattern",render:r=><Mono>{r.pattern_matched||"—"}</Mono>},
        {label:"Severity",render:r=><SeverityBadge sev={r.secret_class||r.highest_severity}/>},
        {label:"Length",render:r=>r.content_length||"—",right:true},
        {label:"",render:r=><ViewBtn has={r.has_content} onClick={()=>setPreview(r)}/>,right:true},
      ]} rows={(events||[]).filter(e=>e.event_kind!=="file_upload"&&isHiCrit(e.secret_class||e.highest_severity))} empty="No high or critical prompt events yet."/>
    </div>

    <div className="aihub_card">
      <SectionHeader title="File uploads" hint="High & critical severity only. Click Open to view the file inline."/>
      <DataTable onRow={r=>{ if(r.has_content) setPreview(r); }} columns={[
        {label:"When",render:r=>relTime(r.occurred_at)},
        {label:"Service",render:r=><ServiceCell row={r}/>},
        {label:"Filename",render:r=><Mono>{r.metadata?.filename||"—"}</Mono>},
        {label:"Class",render:r=><Tag text={r.file_class||"—"}/>},
        {label:"Severity",render:r=><SeverityBadge sev={r.severity||r.highest_severity}/>},
        {label:"Size",render:r=>r.metadata?.size_bucket||"—",right:true},
        {label:"Via",render:r=><Badge text={r.metadata?.via||"—"}/>},
        {label:"",render:r=><ViewBtn has={r.has_content} onClick={()=>setPreview(r)} label="Open"/>,right:true},
      ]} rows={(files||[]).filter(f=>isHiCrit(f.severity||f.highest_severity))} empty="No high or critical file upload events yet."/>
    </div>

    {preview && <ContentDrawer eventId={preview.id} meta={preview} onClose={()=>setPreview(null)}/>}
  </div>);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 7. AI PLATFORMS
// ═══════════════════════════════════════════════════════════════════════════════
function PlatformsView() {
  const [rows,setRows]=useState(null),[e,setE]=useState(null),[q,setQ]=useState(""),[busy,setBusy]=useState(null);
  useEffect(()=>{apiFetch("/ai-platforms").then(setRows).catch(x=>setE(x.message))},[]);

  // Admin toggle: allow ⇄ block a platform. A blocked platform is enforced by
  // the browser extension — users can't send any prompt to that host.
  async function toggleBlocked(r){
    const next=!r.blocked; setBusy(r.host);
    try{
      const res=await fetch(`${API}/ai-platforms/${encodeURIComponent(r.host)}`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({blocked:next})});
      if(!res.ok) throw new Error(`HTTP ${res.status}`);
      const updated=await res.json();
      setRows(prev=>prev.map(x=>x.host===r.host?{...x,blocked:updated.blocked}:x));
    }catch(err){ alert("Failed to update platform: "+err.message); }
    finally{ setBusy(null); }
  }

  if(e) return <Err msg={e}/>; if(!rows) return <Loading/>;

  const governed=rows.filter(r=>r.governed).length;
  const adminAdded=rows.filter(r=>r.source==="admin").length;
  const llmDisc=rows.filter(r=>r.source==="classifier").length;
  const blockedCount=rows.filter(r=>r.blocked).length;
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
      <StatCard icon={<X size={18}/>} label="Blocked" value={blockedCount} color="#ef4444"/>
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
        {label:"Access",render:r=>(
          <button onClick={()=>toggleBlocked(r)} disabled={busy===r.host} title={r.blocked?"Click to allow":"Click to block (users can't send prompts)"}
            style={{cursor:busy===r.host?"default":"pointer",padding:"3px 10px",borderRadius:6,fontSize:12,fontWeight:600,fontFamily:"inherit",
              border:`1px solid ${r.blocked?"#fca5a5":"#bbf7d0"}`,background:r.blocked?"#fef2f2":"#f0fdf4",color:r.blocked?"#dc2626":"#16a34a",opacity:busy===r.host?0.6:1}}>
            {busy===r.host?"…":r.blocked?"Blocked":"Allowed"}
          </button>
        )},
        {label:"Source",render:r=><Badge text={r.source||"—"}/>},
        {label:"Updated",render:r=>relTime(r.updated_at)},
      ]} rows={filtered}/>
    </div>
  </div>);
}

// ═══════════════════════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════════════════
// COPILOT READINESS — Pre-deployment scan for M365 Copilot
// ═══════════════════════════════════════════════════════════════════════════════
function CopilotReadinessView() {
  const [scan, setScan] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [oauthKeys, setOauthKeys] = useState([]);
  const [selectedKey, setSelectedKey] = useState("");
  const [pollId, setPollId] = useState(null);

  useEffect(() => {
    // Load Microsoft OAuth keys (governance routes are /api/ not /api/v1/)
    fetch("/api/oauth-keys").then(r => r.json()).then(data => {
      const arr = Array.isArray(data) ? data : (data.keys || []);
      const msKeys = arr.filter(k => k.vendor === "microsoft");
      setOauthKeys(msKeys);
      if (msKeys.length >= 1) setSelectedKey(msKeys[0].id);
    }).catch(() => {});
    // Load latest scan
    fetch("/api/copilot-readiness/results").then(r => r.json()).then(data => {
      if (data.scan) setScan(data.scan);
    }).catch(() => {});
  }, []);

  // Poll for scan completion
  useEffect(() => {
    if (!pollId) return;
    const interval = setInterval(() => {
      fetch(`/api/copilot-readiness/results/${pollId}`).then(r => r.json()).then(data => {
        if (data.scan) {
          setScan(data.scan);
          if (data.scan.status !== "running") {
            clearInterval(interval);
            setPollId(null);
            setScanning(false);
          }
        }
      }).catch(() => {});
    }, 3000);
    return () => clearInterval(interval);
  }, [pollId]);

  const runScan = async () => {
    if (!selectedKey) return;
    setScanning(true);
    try {
      const res = await fetch(`/api/copilot-readiness/scan?oauth_key_id=${selectedKey}`, { method: "POST" });
      const data = await res.json();
      if (data.scanId) setPollId(data.scanId);
    } catch (e) {
      setScanning(false);
    }
  };

  const sevColor = { critical: "#ef4444", high: "#f59e0b", medium: "#3b82f6", low: "#22c55e", none: "#9ca3af" };
  const catIcon = { sharepoint: "📂", onedrive: "☁️", teams: "💬", exchange: "📧" };

  return (
    <div>
      {/* Header + Scan button */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20 }}>Copilot Readiness Assessment</h2>
          <p className="aihub_text_muted" style={{ margin: "4px 0 0", fontSize: 13 }}>
            Scan your Microsoft 365 environment for overshared data before enabling Copilot
          </p>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {oauthKeys.length > 1 && (
            <select value={selectedKey} onChange={e => setSelectedKey(e.target.value)}
              style={{ padding: "8px 12px", border: "1px solid #d1d5db", borderRadius: 8, fontSize: 13 }}>
              <option value="">Select tenant...</option>
              {oauthKeys.map(k => <option key={k.id} value={k.id}>{k.tenant_id || k.id}</option>)}
            </select>
          )}
          <button onClick={runScan} disabled={scanning || !selectedKey}
            style={{ background: scanning ? "#9ca3af" : "#2563eb", color: "#fff", border: "none", borderRadius: 8, padding: "10px 20px", fontSize: 14, fontWeight: 600, cursor: scanning ? "default" : "pointer", display: "flex", alignItems: "center", gap: 6 }}>
            {scanning ? <><RefreshCw size={14} className="aihub_spin" /> Scanning...</> : <><Scan size={14} /> Run Assessment</>}
          </button>
        </div>
      </div>

      {/* No Microsoft tenant connected */}
      {oauthKeys.length === 0 && (
        <Empty icon={<Shield size={32} />} title="No Microsoft 365 tenant connected"
          msg="Connect your Microsoft tenant in Agent Governance → Setup to run the Copilot Readiness Assessment." />
      )}

      {/* Scan results */}
      {scan && scan.status === "completed" && (<>
        {/* Risk score banner */}
        <div style={{ background: sevColor[scan.riskLevel] + "10", border: "1px solid " + sevColor[scan.riskLevel] + "40", borderRadius: 12, padding: 20, marginBottom: 20, display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ width: 60, height: 60, borderRadius: "50%", background: sevColor[scan.riskLevel] + "20", color: sevColor[scan.riskLevel], display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, fontWeight: 700 }}>
            {scan.riskLevel === "critical" ? "!" : scan.riskLevel === "high" ? "⚠" : scan.riskLevel === "none" ? "✓" : "~"}
          </div>
          <div>
            <div style={{ fontSize: 22, fontWeight: 700, color: sevColor[scan.riskLevel], textTransform: "uppercase" }}>{scan.riskLevel} Risk</div>
            <div style={{ fontSize: 13, color: "#475569", marginTop: 2 }}>
              {scan.summary.totalFindings} finding{scan.summary.totalFindings !== 1 ? "s" : ""} · ~{scan.summary.estimatedExposedDocs.toLocaleString()} documents potentially exposed · Scanned in {((scan.durationMs || 0) / 1000).toFixed(1)}s
            </div>
          </div>
        </div>

        {/* Summary cards */}
        <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
          <StatCard icon={<span>📂</span>} label="SharePoint" value={scan.summary.sharepoint} hint="Overshared sites" color="#2563eb" />
          <StatCard icon={<span>☁️</span>} label="OneDrive" value={scan.summary.onedrive} hint="Org-wide shares" color="#8b5cf6" />
          <StatCard icon={<span>💬</span>} label="Teams" value={scan.summary.teams} hint="Public teams" color="#22c55e" />
          <StatCard icon={<span>📧</span>} label="Exchange" value={scan.summary.exchange} hint="Delegate access" color="#f59e0b" />
        </div>

        {/* Severity breakdown */}
        <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
          {[["critical", scan.summary.critical], ["high", scan.summary.high], ["medium", scan.summary.medium], ["low", scan.summary.low]].map(([sev, count]) => (
            <div key={sev} style={{ padding: "6px 12px", borderRadius: 6, background: sevColor[sev] + "14", color: sevColor[sev], fontSize: 12, fontWeight: 600 }}>
              {sev}: {count}
            </div>
          ))}
        </div>

        {/* Findings table */}
        <SectionHeader title="Findings" hint="Each finding represents an oversharing risk that Copilot would expose" />
        <DataTable
          columns={[
            { label: "Sev", render: r => <div style={{ width: 8, height: 8, borderRadius: "50%", background: sevColor[r.severity] }} />, },
            { label: "Category", render: r => <span>{catIcon[r.category] || ""} {r.category}</span> },
            { label: "Finding", render: r => <div><div className="aihub_text_primary" style={{ fontSize: 13 }}>{r.title}</div><div className="aihub_text_muted" style={{ fontSize: 11, marginTop: 2 }}>{r.description.length > 120 ? r.description.slice(0, 120) + "…" : r.description}</div></div> },
            { label: "Exposed To", render: r => <span style={{ fontSize: 12 }}>{r.exposedTo}</span> },
            { label: "Remediation", render: r => <span className="aihub_text_muted" style={{ fontSize: 11 }}>{r.remediation.length > 80 ? r.remediation.slice(0, 80) + "…" : r.remediation}</span> },
          ]}
          rows={scan.findings || []}
          empty="No oversharing risks found — your environment looks clean!"
        />

        {/* Scan metadata */}
        <div className="aihub_text_muted" style={{ fontSize: 11, marginTop: 16 }}>
          Scan ID: {scan.id} · Started: {new Date(scan.startedAt).toLocaleString()} · Duration: {((scan.durationMs || 0) / 1000).toFixed(1)}s
        </div>
      </>)}

      {/* Scan running */}
      {scan && scan.status === "running" && (
        <div style={{ textAlign: "center", padding: 60 }}>
          <RefreshCw size={32} className="aihub_spin" style={{ color: "#2563eb", marginBottom: 12 }} />
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>Scanning your Microsoft 365 environment...</div>
          <div className="aihub_text_muted">Checking SharePoint, OneDrive, Teams, and Exchange for overshared permissions. This usually takes 1-2 minutes.</div>
        </div>
      )}

      {/* Scan failed */}
      {scan && scan.status === "failed" && (
        <Err msg={`Scan failed: ${scan.error || "Unknown error"}. Check that your Microsoft tenant is connected with the correct permissions.`} />
      )}

      {/* No scan yet */}
      {!scan && oauthKeys.length > 0 && !scanning && (
        <div style={{ textAlign: "center", padding: 60, background: "#f8fafc", borderRadius: 12, border: "1px solid #e5e7eb" }}>
          <Shield size={40} style={{ color: "#9ca3af", marginBottom: 12 }} />
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>No assessment run yet</div>
          <div className="aihub_text_muted" style={{ marginBottom: 16 }}>Click "Run Assessment" to scan your Microsoft 365 environment for oversharing risks before enabling Copilot.</div>
          <div style={{ fontSize: 12, color: "#6b7280", maxWidth: 500, margin: "0 auto", lineHeight: 1.6 }}>
            The scan checks: SharePoint site permissions, OneDrive org-wide shares, public Teams channels, and Exchange delegate access.
            It reads permissions only — no data is modified.
          </div>
        </div>
      )}
    </div>
  );
}


// ── Model Routing View ─────────────────────────────────────────────────────
// Sub-tabs: Overview, Rules, Endpoints, Routing Log

const ROUTING_API = "/api/v1/routing";
async function routingFetch(path, opts) {
  const r = await fetch(`${ROUTING_API}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
}

const SEVERITY_OPTIONS = ["critical","high","moderate","low"];
const COMPLEXITY_OPTIONS = ["simple","moderate","complex"];
const PROVIDER_OPTIONS = ["openai","anthropic","google","microsoft","perplexity","huggingface"];
const MODEL_SUGGESTIONS = {
  openai:["gpt-4","gpt-4-turbo","gpt-4o","gpt-4o-mini","gpt-4.1","gpt-4.1-mini","gpt-4.1-nano","gpt-3.5-turbo","o1","o1-mini","o3","o3-mini","o4-mini"],
  anthropic:["claude-opus-4-20250514","claude-sonnet-4-20250514","claude-haiku-4-5-20251001","claude-3-5-sonnet-20241022","claude-3-5-haiku-20241022"],
  google:["gemini-2.5-pro","gemini-2.5-flash","gemini-2.0-flash","gemini-2.0-pro","gemini-1.5-pro","gemini-1.5-flash"],
};

function MultiSelect({options,value=[],onChange,label}) {
  return (<div style={{marginBottom:10}}>
    {label&&<div style={{fontSize:12,fontWeight:600,color:"#374151",marginBottom:4}}>{label}</div>}
    <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
      {options.map(o=>{
        const sel=value.includes(o);
        return <button key={o} type="button" onClick={()=>onChange(sel?value.filter(v=>v!==o):[...value,o])}
          style={{padding:"3px 10px",borderRadius:6,fontSize:11,fontWeight:600,border:"1px solid",cursor:"pointer",
            background:sel?"#0044cc14":"#fff",color:sel?"#0044cc":"#6b7280",borderColor:sel?"#0044cc30":"#e5e7eb"}}>{o}</button>;
      })}
    </div>
  </div>);
}

function RuleFormModal({rule,onSave,onClose}) {
  const isEdit=!!rule?.id;
  const [name,setName]=useState(rule?.name||"");
  const [priority,setPriority]=useState(rule?.priority??50);
  const [enabled,setEnabled]=useState(rule?.enabled??true);
  const [condSensitivity,setCondSensitivity]=useState(rule?.conditions?.sensitivity||[]);
  const [condComplexity,setCondComplexity]=useState(rule?.conditions?.complexity||[]);
  const [condProvider,setCondProvider]=useState(rule?.conditions?.provider||[]);
  const [condModel,setCondModel]=useState((rule?.conditions?.model||[]).join(", "));
  const [condTokensGt,setCondTokensGt]=useState(rule?.conditions?.prompt_tokens_gt??"");
  const [condTokensLt,setCondTokensLt]=useState(rule?.conditions?.prompt_tokens_lt??"");
  const [actionModel,setActionModel]=useState(rule?.action?.model||"");
  const [actionHost,setActionHost]=useState(rule?.action?.host||"");
  const [saving,setSaving]=useState(false);

  const handleSave=async()=>{
    if(!name.trim()||!actionModel.trim()) return;
    setSaving(true);
    const conditions={};
    if(condSensitivity.length) conditions.sensitivity=condSensitivity;
    if(condComplexity.length) conditions.complexity=condComplexity;
    if(condProvider.length) conditions.provider=condProvider;
    if(condModel.trim()) conditions.model=condModel.split(",").map(s=>s.trim()).filter(Boolean);
    if(condTokensGt!=="") conditions.prompt_tokens_gt=Number(condTokensGt);
    if(condTokensLt!=="") conditions.prompt_tokens_lt=Number(condTokensLt);
    const action={model:actionModel.trim()};
    if(actionHost.trim()) action.host=actionHost.trim();
    try {
      if(isEdit) await routingFetch(`/rules/${rule.id}`,{method:"PUT",body:JSON.stringify({name,priority:Number(priority),enabled,conditions,action})});
      else await routingFetch("/rules",{method:"POST",body:JSON.stringify({name,priority:Number(priority),enabled,conditions,action})});
      onSave();
    } catch(e) { alert("Error: "+e.message); }
    setSaving(false);
  };

  return (<div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.4)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center"}} onClick={onClose}>
    <div style={{background:"#fff",borderRadius:14,padding:24,width:560,maxHeight:"85vh",overflowY:"auto",boxShadow:"0 20px 60px rgba(0,0,0,0.15)"}} onClick={e=>e.stopPropagation()}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:18}}>
        <h3 style={{margin:0,fontSize:16,fontWeight:700}}>{isEdit?"Edit Rule":"Create Routing Rule"}</h3>
        <button onClick={onClose} style={{background:"none",border:"none",cursor:"pointer"}}><X size={18} color="#6b7280"/></button>
      </div>

      <div style={{marginBottom:12}}>
        <label style={{fontSize:12,fontWeight:600,color:"#374151"}}>Rule Name *</label>
        <input value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. Route simple tasks to cheap model"
          style={{width:"100%",padding:"8px 12px",border:"1px solid #e5e7eb",borderRadius:8,fontSize:13,marginTop:4,boxSizing:"border-box"}}/>
      </div>
      <div style={{display:"flex",gap:12,marginBottom:12}}>
        <div style={{flex:1}}>
          <label style={{fontSize:12,fontWeight:600,color:"#374151"}}>Priority (lower = first)</label>
          <input type="number" value={priority} onChange={e=>setPriority(e.target.value)} style={{width:"100%",padding:"8px 12px",border:"1px solid #e5e7eb",borderRadius:8,fontSize:13,marginTop:4,boxSizing:"border-box"}}/>
        </div>
        <div style={{flex:1,display:"flex",alignItems:"flex-end",paddingBottom:4}}>
          <label style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer",fontSize:13}}>
            <input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)}/> Enabled
          </label>
        </div>
      </div>

      <div style={{background:"#f9fafb",borderRadius:10,padding:14,marginBottom:14}}>
        <div style={{fontSize:13,fontWeight:700,color:"#111827",marginBottom:10}}>Conditions <span style={{fontWeight:400,color:"#9ca3af"}}>(all must match)</span></div>
        <MultiSelect label="Data Sensitivity" options={SEVERITY_OPTIONS} value={condSensitivity} onChange={setCondSensitivity}/>
        <MultiSelect label="Prompt Complexity" options={COMPLEXITY_OPTIONS} value={condComplexity} onChange={setCondComplexity}/>
        <MultiSelect label="Provider" options={PROVIDER_OPTIONS} value={condProvider} onChange={setCondProvider}/>
        <div style={{marginBottom:10}}>
          <label style={{fontSize:12,fontWeight:600,color:"#374151"}}>Original Model (comma-separated patterns)</label>
          <input value={condModel} onChange={e=>setCondModel(e.target.value)} placeholder="e.g. gpt-4, claude-opus"
            style={{width:"100%",padding:"8px 12px",border:"1px solid #e5e7eb",borderRadius:8,fontSize:13,marginTop:4,boxSizing:"border-box"}}/>
        </div>
        <div style={{display:"flex",gap:12}}>
          <div style={{flex:1}}>
            <label style={{fontSize:12,fontWeight:600,color:"#374151"}}>Tokens &gt;</label>
            <input type="number" value={condTokensGt} onChange={e=>setCondTokensGt(e.target.value)} placeholder="e.g. 500"
              style={{width:"100%",padding:"8px 12px",border:"1px solid #e5e7eb",borderRadius:8,fontSize:13,marginTop:4,boxSizing:"border-box"}}/>
          </div>
          <div style={{flex:1}}>
            <label style={{fontSize:12,fontWeight:600,color:"#374151"}}>Tokens &lt;</label>
            <input type="number" value={condTokensLt} onChange={e=>setCondTokensLt(e.target.value)} placeholder="e.g. 200"
              style={{width:"100%",padding:"8px 12px",border:"1px solid #e5e7eb",borderRadius:8,fontSize:13,marginTop:4,boxSizing:"border-box"}}/>
          </div>
        </div>
      </div>

      <div style={{background:"#f0f9ff",borderRadius:10,padding:14,marginBottom:18}}>
        <div style={{fontSize:13,fontWeight:700,color:"#111827",marginBottom:10}}>Action — Route To</div>
        <div style={{marginBottom:10}}>
          <label style={{fontSize:12,fontWeight:600,color:"#374151"}}>Target Model *</label>
          <input value={actionModel} onChange={e=>setActionModel(e.target.value)} placeholder="e.g. gpt-4o-mini"
            style={{width:"100%",padding:"8px 12px",border:"1px solid #e5e7eb",borderRadius:8,fontSize:13,marginTop:4,boxSizing:"border-box"}}/>
          <div style={{display:"flex",flexWrap:"wrap",gap:4,marginTop:6}}>
            {[...MODEL_SUGGESTIONS.openai.slice(0,4),...MODEL_SUGGESTIONS.anthropic.slice(0,3),...MODEL_SUGGESTIONS.google.slice(0,2)].map(m=>
              <button key={m} type="button" onClick={()=>setActionModel(m)}
                style={{padding:"2px 8px",borderRadius:5,fontSize:10,border:"1px solid #e5e7eb",background:actionModel===m?"#0044cc14":"#fff",color:actionModel===m?"#0044cc":"#6b7280",cursor:"pointer"}}>{m}</button>
            )}
          </div>
        </div>
        <div>
          <label style={{fontSize:12,fontWeight:600,color:"#374151"}}>Target Host <span style={{fontWeight:400,color:"#9ca3af"}}>(optional, for private endpoints)</span></label>
          <input value={actionHost} onChange={e=>setActionHost(e.target.value)} placeholder="e.g. my-company.openai.azure.com"
            style={{width:"100%",padding:"8px 12px",border:"1px solid #e5e7eb",borderRadius:8,fontSize:13,marginTop:4,boxSizing:"border-box"}}/>
        </div>
      </div>

      <div style={{display:"flex",justifyContent:"flex-end",gap:10}}>
        <button onClick={onClose} style={{padding:"8px 20px",borderRadius:8,border:"1px solid #e5e7eb",background:"#fff",cursor:"pointer",fontSize:13}}>Cancel</button>
        <button onClick={handleSave} disabled={saving||!name.trim()||!actionModel.trim()}
          style={{padding:"8px 20px",borderRadius:8,border:"none",background:"#0044cc",color:"#fff",cursor:"pointer",fontSize:13,fontWeight:600,opacity:saving||!name.trim()||!actionModel.trim()?0.5:1}}>{saving?"Saving...":isEdit?"Save Changes":"Create Rule"}</button>
      </div>
    </div>
  </div>);
}

function ModelRoutingView() {
  const [tab,setTab]=useState("overview");
  const [rules,setRules]=useState(null);
  const [endpoints,setEndpoints]=useState(null);
  const [analytics,setAnalytics]=useState(null);
  const [routingLog,setRoutingLog]=useState(null);
  const [err,setErr]=useState(null);
  const [showRuleForm,setShowRuleForm]=useState(false);
  const [editRule,setEditRule]=useState(null);

  const loadAll=()=>{
    Promise.all([
      routingFetch("/rules"),
      routingFetch("/endpoints"),
      routingFetch("/analytics"),
      routingFetch("/log?limit=50"),
    ]).then(([r,e,a,l])=>{ setRules(r); setEndpoints(e); setAnalytics(a); setRoutingLog(l); })
      .catch(x=>setErr(x.message));
  };
  useEffect(loadAll,[]);

  const deleteRule=async(id)=>{ if(!confirm("Delete this rule?")) return; await routingFetch(`/rules/${id}`,{method:"DELETE"}); loadAll(); };
  const toggleRule=async(r)=>{ await routingFetch(`/rules/${r.id}`,{method:"PUT",body:JSON.stringify({enabled:!r.enabled})}); loadAll(); };

  // Endpoint CRUD
  const [showEpForm,setShowEpForm]=useState(false);
  const [epName,setEpName]=useState(""); const [epProvider,setEpProvider]=useState("openai"); const [epHost,setEpHost]=useState("");
  const [epModels,setEpModels]=useState(""); const [epRegion,setEpRegion]=useState("");
  const saveEndpoint=async()=>{
    if(!epName.trim()) return;
    await routingFetch("/endpoints",{method:"POST",body:JSON.stringify({name:epName,provider:epProvider,host:epHost||null,models:epModels.split(",").map(s=>s.trim()).filter(Boolean),region:epRegion||null})});
    setShowEpForm(false); setEpName(""); setEpHost(""); setEpModels(""); setEpRegion(""); loadAll();
  };
  const deleteEndpoint=async(id)=>{ if(!confirm("Delete this endpoint?")) return; await routingFetch(`/endpoints/${id}`,{method:"DELETE"}); loadAll(); };

  if(err) return <Err msg={err}/>;
  if(!rules) return <Loading/>;

  const activeRules=rules.filter(r=>r.enabled).length;
  const tabs=[
    {id:"overview",label:"Overview"},
    {id:"rules",label:`Rules (${rules.length})`},
    {id:"endpoints",label:`Endpoints (${(endpoints||[]).length})`},
    {id:"log",label:"Routing Log"},
  ];

  return (<div>
    <SectionHeader title="Intelligent Model Routing" hint="Automatically route AI requests to the optimal model based on cost, sensitivity, and complexity"/>

    {/* Stat Cards */}
    <div className="aihub_stat_grid">
      <StatCard icon={<Activity size={18}/>} label="Requests Routed" value={analytics?.total_routed||0} hint={`${analytics?.last_24h||0} in last 24h`} color="#0044cc"/>
      <StatCard icon={<Shield size={18}/>} label="Active Rules" value={activeRules} hint={`${rules.length} total`} color="#8b5cf6"/>
      <StatCard icon={<Server size={18}/>} label="Endpoints" value={analytics?.active_endpoints||0} color="#22c55e"/>
      <StatCard icon={<Activity size={18}/>} label="Last 7 Days" value={analytics?.last_7d||0} color="#f59e0b"/>
    </div>

    {/* Tabs */}
    <div style={{display:"flex",gap:2,marginBottom:16,borderBottom:"2px solid #f3f4f6"}}>
      {tabs.map(t=><button key={t.id} onClick={()=>setTab(t.id)}
        style={{padding:"8px 18px",fontSize:13,fontWeight:tab===t.id?700:500,border:"none",borderBottom:tab===t.id?"2px solid #0044cc":"2px solid transparent",
          background:"none",color:tab===t.id?"#0044cc":"#6b7280",cursor:"pointer",marginBottom:-2}}>{t.label}</button>)}
    </div>

    {/* ── Overview Tab ── */}
    {tab==="overview"&&(<div>
      {analytics?.total_routed===0 ? (
        <div className="aihub_card" style={{textAlign:"center",padding:"40px 20px"}}>
          <Activity size={40} color="#d1d5db" style={{marginBottom:12}}/>
          <h4 style={{margin:"0 0 8px",color:"#374151"}}>No routing activity yet</h4>
          <p style={{color:"#9ca3af",fontSize:13,maxWidth:400,margin:"0 auto 16px"}}>
            Create routing rules to automatically swap expensive models for cheaper ones on simple tasks, route sensitive data to private endpoints, and set up failover.
          </p>
          <button onClick={()=>{setTab("rules");setShowRuleForm(true);}} style={{padding:"8px 20px",borderRadius:8,border:"none",background:"#0044cc",color:"#fff",cursor:"pointer",fontSize:13,fontWeight:600}}>
            <Plus size={14} style={{verticalAlign:"middle",marginRight:4}}/> Create First Rule
          </button>
        </div>
      ):(
        <div className="aihub_two_col">
          <div className="aihub_card">
            <h4 style={{margin:"0 0 12px",fontSize:14,fontWeight:700}}>Model Swaps</h4>
            {(analytics?.by_model||[]).length?<DataTable columns={[
              {label:"Original Model",render:r=><Mono>{r.from||"—"}</Mono>},
              {label:"Routed To",render:r=><Badge text={r.to||"—"} color="#0044cc"/>},
              {label:"Count",key:"count",right:true},
            ]} rows={analytics.by_model}/>:<div className="aihub_text_muted" style={{padding:16}}>No data yet</div>}
          </div>
          <div>
            <div className="aihub_card" style={{marginBottom:16}}>
              <h4 style={{margin:"0 0 12px",fontSize:14,fontWeight:700}}>By Rule</h4>
              <BarChart data={(analytics?.by_rule||[]).map(r=>({label:r.name||"unknown",count:r.count}))} lk="label" vk="count"/>
            </div>
            <div className="aihub_card">
              <h4 style={{margin:"0 0 12px",fontSize:14,fontWeight:700}}>By Complexity</h4>
              <div style={{display:"flex",gap:8}}>
                {(analytics?.by_complexity||[]).map(c=>
                  <div key={c.complexity} style={{flex:1,textAlign:"center",padding:12,borderRadius:8,background:"#f9fafb"}}>
                    <div style={{fontSize:20,fontWeight:700,color:"#111827"}}>{c.count}</div>
                    <div style={{fontSize:11,color:"#6b7280",textTransform:"capitalize"}}>{c.complexity||"unknown"}</div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>)}

    {/* ── Rules Tab ── */}
    {tab==="rules"&&(<div>
      <div style={{display:"flex",justifyContent:"flex-end",marginBottom:12}}>
        <button onClick={()=>{setEditRule(null);setShowRuleForm(true);}}
          style={{display:"flex",alignItems:"center",gap:6,padding:"8px 16px",borderRadius:8,border:"none",background:"#0044cc",color:"#fff",cursor:"pointer",fontSize:13,fontWeight:600}}>
          <Plus size={14}/> Add Rule
        </button>
      </div>
      <div className="aihub_card">
        <DataTable columns={[
          {label:"Priority",render:r=><span style={{fontWeight:700,color:"#6b7280"}}>{r.priority}</span>},
          {label:"Rule Name",render:r=><div><div className="aihub_text_primary">{r.name}</div></div>},
          {label:"Conditions",render:r=>{
            const c=r.conditions||{};
            const tags=[];
            if(c.sensitivity) tags.push(...(Array.isArray(c.sensitivity)?c.sensitivity:[c.sensitivity]).map(s=>"sensitivity:"+s));
            if(c.complexity) tags.push(...(Array.isArray(c.complexity)?c.complexity:[c.complexity]).map(s=>"complexity:"+s));
            if(c.provider) tags.push(...(Array.isArray(c.provider)?c.provider:[c.provider]).map(s=>"provider:"+s));
            if(c.model) tags.push(...(Array.isArray(c.model)?c.model:[c.model]).map(s=>"model:"+s));
            if(c.prompt_tokens_gt!=null) tags.push("tokens>"+c.prompt_tokens_gt);
            if(c.prompt_tokens_lt!=null) tags.push("tokens<"+c.prompt_tokens_lt);
            return <div style={{display:"flex",flexWrap:"wrap",gap:3}}>{tags.map(t=><Tag key={t} text={t}/>)}</div>;
          }},
          {label:"Route To",render:r=><Badge text={r.action?.model||"—"} color="#0044cc"/>},
          {label:"Status",render:r=><Badge text={r.enabled?"Active":"Disabled"} color={r.enabled?"#22c55e":"#9ca3af"}/>},
          {label:"Actions",render:r=><div style={{display:"flex",gap:6}}>
            <button onClick={()=>{setEditRule(r);setShowRuleForm(true);}} style={{background:"none",border:"none",cursor:"pointer",color:"#0044cc",fontSize:12,fontWeight:600}}>Edit</button>
            <button onClick={()=>toggleRule(r)} style={{background:"none",border:"none",cursor:"pointer",color:"#f59e0b",fontSize:12,fontWeight:600}}>{r.enabled?"Disable":"Enable"}</button>
            <button onClick={()=>deleteRule(r.id)} style={{background:"none",border:"none",cursor:"pointer",color:"#ef4444",fontSize:12,fontWeight:600}}>Delete</button>
          </div>},
        ]} rows={rules} empty="No routing rules yet. Click 'Add Rule' to create one."/>
      </div>

      {/* Example rules hint */}
      {rules.length===0&&(
        <div className="aihub_card" style={{background:"#f0f9ff",border:"1px solid #bfdbfe"}}>
          <h4 style={{margin:"0 0 10px",fontSize:14,fontWeight:700,color:"#1e40af"}}>Example Routing Rules</h4>
          <div style={{fontSize:13,color:"#374151",lineHeight:1.8}}>
            <strong>Cost Optimization:</strong> When complexity = "simple" → route to gpt-4o-mini (saves ~66x on token cost)<br/>
            <strong>Data Protection:</strong> When sensitivity = "critical" or "high" → route to your private Azure endpoint<br/>
            <strong>Compliance:</strong> When provider = "openai" and model contains "gpt-4" → route to EU-hosted deployment<br/>
            <strong>Budget Control:</strong> When tokens &gt; 5000 → route to gpt-4o-mini (long prompts get expensive fast)
          </div>
        </div>
      )}
    </div>)}

    {/* ── Endpoints Tab ── */}
    {tab==="endpoints"&&(<div>
      <div style={{display:"flex",justifyContent:"flex-end",marginBottom:12}}>
        <button onClick={()=>setShowEpForm(!showEpForm)}
          style={{display:"flex",alignItems:"center",gap:6,padding:"8px 16px",borderRadius:8,border:"none",background:"#0044cc",color:"#fff",cursor:"pointer",fontSize:13,fontWeight:600}}>
          <Plus size={14}/> Add Endpoint
        </button>
      </div>

      {showEpForm&&(
        <div className="aihub_card" style={{marginBottom:16,background:"#f9fafb"}}>
          <h4 style={{margin:"0 0 12px",fontSize:14,fontWeight:700}}>Register Endpoint</h4>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            <div>
              <label style={{fontSize:12,fontWeight:600,color:"#374151"}}>Name *</label>
              <input value={epName} onChange={e=>setEpName(e.target.value)} placeholder="e.g. Azure OpenAI Frankfurt"
                style={{width:"100%",padding:"8px 12px",border:"1px solid #e5e7eb",borderRadius:8,fontSize:13,marginTop:4,boxSizing:"border-box"}}/>
            </div>
            <div>
              <label style={{fontSize:12,fontWeight:600,color:"#374151"}}>Provider</label>
              <select value={epProvider} onChange={e=>setEpProvider(e.target.value)}
                style={{width:"100%",padding:"8px 12px",border:"1px solid #e5e7eb",borderRadius:8,fontSize:13,marginTop:4,boxSizing:"border-box"}}>
                {PROVIDER_OPTIONS.map(p=><option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label style={{fontSize:12,fontWeight:600,color:"#374151"}}>Host</label>
              <input value={epHost} onChange={e=>setEpHost(e.target.value)} placeholder="e.g. my-company.openai.azure.com"
                style={{width:"100%",padding:"8px 12px",border:"1px solid #e5e7eb",borderRadius:8,fontSize:13,marginTop:4,boxSizing:"border-box"}}/>
            </div>
            <div>
              <label style={{fontSize:12,fontWeight:600,color:"#374151"}}>Models (comma-separated)</label>
              <input value={epModels} onChange={e=>setEpModels(e.target.value)} placeholder="e.g. gpt-4o, gpt-4o-mini"
                style={{width:"100%",padding:"8px 12px",border:"1px solid #e5e7eb",borderRadius:8,fontSize:13,marginTop:4,boxSizing:"border-box"}}/>
            </div>
            <div>
              <label style={{fontSize:12,fontWeight:600,color:"#374151"}}>Region</label>
              <input value={epRegion} onChange={e=>setEpRegion(e.target.value)} placeholder="e.g. eu-west, us-east"
                style={{width:"100%",padding:"8px 12px",border:"1px solid #e5e7eb",borderRadius:8,fontSize:13,marginTop:4,boxSizing:"border-box"}}/>
            </div>
            <div style={{display:"flex",alignItems:"flex-end",gap:8}}>
              <button onClick={saveEndpoint} disabled={!epName.trim()}
                style={{padding:"8px 20px",borderRadius:8,border:"none",background:"#0044cc",color:"#fff",cursor:"pointer",fontSize:13,fontWeight:600,opacity:!epName.trim()?0.5:1}}>Save</button>
              <button onClick={()=>setShowEpForm(false)} style={{padding:"8px 20px",borderRadius:8,border:"1px solid #e5e7eb",background:"#fff",cursor:"pointer",fontSize:13}}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      <div className="aihub_card">
        <DataTable columns={[
          {label:"Name",render:r=><div className="aihub_text_primary">{r.name}</div>},
          {label:"Provider",render:r=><Badge text={r.provider} color="#6366f1"/>},
          {label:"Host",render:r=><Mono>{r.host||"(default)"}</Mono>},
          {label:"Models",render:r=><div style={{display:"flex",flexWrap:"wrap",gap:3}}>{(r.models||[]).map(m=><Tag key={m} text={m}/>)}</div>},
          {label:"Region",render:r=>r.region||"—"},
          {label:"Status",render:r=><Badge text={r.enabled?"Active":"Disabled"} color={r.enabled?"#22c55e":"#9ca3af"}/>},
          {label:"",render:r=><button onClick={()=>deleteEndpoint(r.id)} style={{background:"none",border:"none",cursor:"pointer",color:"#ef4444"}}><Trash2 size={14}/></button>},
        ]} rows={endpoints||[]} empty="No endpoints registered. Add a private endpoint for sensitive data routing."/>
      </div>
    </div>)}

    {/* ── Routing Log Tab ── */}
    {tab==="log"&&(<div>
      <div className="aihub_card">
        <DataTable columns={[
          {label:"Time",render:r=>relTime(r.timestamp)},
          {label:"Original Model",render:r=><Mono>{r.original_model||"—"}</Mono>},
          {label:"Routed To",render:r=><Badge text={r.routed_model||"—"} color="#0044cc"/>},
          {label:"Rule",render:r=><div className="aihub_text_muted">{r.rule_name||"—"}</div>},
          {label:"Sensitivity",render:r=>r.sensitivity?<SeverityBadge sev={r.sensitivity}/>:<span className="aihub_text_muted">—</span>},
          {label:"Complexity",render:r=>r.complexity?<Badge text={r.complexity} color={r.complexity==="simple"?"#22c55e":r.complexity==="complex"?"#ef4444":"#f59e0b"}/>:<span className="aihub_text_muted">—</span>},
          {label:"Tokens",render:r=>r.prompt_tokens_est?fmtTokens(r.prompt_tokens_est):"—",right:true},
        ]} rows={routingLog||[]} empty="No routing events yet. Routing decisions will appear here once rules are active and AI requests flow through the proxy."/>
      </div>
    </div>)}

    {/* Rule Form Modal */}
    {showRuleForm&&<RuleFormModal rule={editRule} onSave={()=>{setShowRuleForm(false);setEditRule(null);loadAll();}} onClose={()=>{setShowRuleForm(false);setEditRule(null);}}/>}
  </div>);
}

// ── Risk Score View ────────────────────────────────────────────────────────

const RISK_API = "/api/v1/risk-scores";
const IDENTITY_API = "/api/v1/identity";

const RISK_COLORS = { low: "#22c55e", medium: "#f59e0b", high: "#ef4444", critical: "#991b1b" };
const RISK_BG     = { low: "#f0fdf4", medium: "#fffbeb", high: "#fef2f2", critical: "#fef2f2" };

function RiskLevelBadge({ level, score }) {
  const c = RISK_COLORS[level] || "#6b7280";
  return <span style={{display:"inline-flex",alignItems:"center",gap:6,padding:"3px 10px",borderRadius:8,fontSize:12,fontWeight:700,background:c+"14",color:c,border:"1px solid "+c+"30"}}>
    <span style={{width:8,height:8,borderRadius:"50%",background:c,display:"inline-block"}}/> {score} — {(level||"unknown").charAt(0).toUpperCase()+(level||"").slice(1)}
  </span>;
}

function ScoreBar({ score }) {
  const c = score<=30?"#22c55e":score<=60?"#f59e0b":score<=80?"#ef4444":"#991b1b";
  return <div style={{width:"100%",height:8,background:"#f3f4f6",borderRadius:4,overflow:"hidden"}}>
    <div style={{width:score+"%",height:"100%",background:c,borderRadius:4,transition:"width 0.4s ease"}}/>
  </div>;
}

function FactorRow({ label, factor }) {
  if (!factor) return null;
  const pct = Math.min(factor.score, 100);
  const c = pct > 60 ? "#ef4444" : pct > 30 ? "#f59e0b" : "#22c55e";
  return <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}>
    <div style={{width:140,fontSize:12,color:"#6b7280",flexShrink:0}}>{label}</div>
    <div style={{flex:1,height:6,background:"#f3f4f6",borderRadius:3,overflow:"hidden"}}>
      <div style={{width:pct+"%",height:"100%",background:c,borderRadius:3}}/>
    </div>
    <div style={{width:50,fontSize:12,fontWeight:600,color:c,textAlign:"right"}}>{factor.raw}</div>
    <div style={{width:40,fontSize:11,color:"#9ca3af",textAlign:"right"}}>{factor.weight}%</div>
  </div>;
}

function RiskScoreView() {
  const [scores,setScores]=useState(null);
  const [summary,setSummary]=useState(null);
  const [err,setErr]=useState(null);
  const [computing,setComputing]=useState(false);
  const [selected,setSelected]=useState(null);
  const [detail,setDetail]=useState(null);

  const loadAll=()=>{
    Promise.all([
      apiFetch("/risk-scores"),
      apiFetch("/risk-scores/summary"),
    ]).then(([s,sum])=>{ setScores(s); setSummary(sum); })
      .catch(x=>setErr(x.message));
  };
  useEffect(loadAll,[]);

  const compute=async()=>{
    setComputing(true);
    try {
      // First resolve profiles, then compute scores
      await fetch(IDENTITY_API+"/resolve",{method:"POST"});
      await fetch(RISK_API+"/compute",{method:"POST"});
      loadAll();
    } catch(e) { setErr(e.message); }
    setComputing(false);
  };

  const showDetail=async(profileId)=>{
    try {
      const r=await fetch(RISK_API+"/"+profileId);
      if(!r.ok) throw new Error(""+r.status);
      const d=await r.json();
      setDetail(d);
      setSelected(profileId);
    } catch(e) { setErr(e.message); }
  };

  if(err) return <Err msg={err}/>;
  if(!scores) return <Loading/>;

  // Filter out browser-extension noise (no real identity)
  // Only show employees with real identity — hide unidentified browser extension installs
  const realScores = scores.filter(s => s.display_name && !s.display_name.startsWith('Browser User'));

  return (<div>
    <SectionHeader title="AI Risk Scores" hint="Per-employee AI safety score — 0 (safe) to 100 (critical)"
      action={<button onClick={compute} disabled={computing} style={{display:"flex",alignItems:"center",gap:6,padding:"8px 16px",borderRadius:8,border:"none",background:"#0044cc",color:"#fff",cursor:"pointer",fontSize:13,fontWeight:600,opacity:computing?0.5:1}}>
        <RefreshCw size={14} className={computing?"aihub_spin":""}/> {computing?"Computing...":"Compute Scores"}
      </button>}
    />

    {/* Summary Cards */}
    {summary && <div className="aihub_stat_grid">
      <StatCard icon={<Shield size={18}/>} label="Average Score" value={summary.average_score} hint={summary.average_score<=30?"Low Risk":summary.average_score<=60?"Medium":"High"} color={summary.average_score<=30?"#22c55e":summary.average_score<=60?"#f59e0b":"#ef4444"}/>
      <StatCard icon={<Activity size={18}/>} label="Total Employees" value={summary.total_employees} color="#0044cc"/>
      <StatCard icon={<Shield size={18}/>} label="Low Risk" value={summary.distribution?.low||0} hint="Score 0-30" color="#22c55e"/>
      <StatCard icon={<AlertTriangle size={18}/>} label="Medium Risk" value={summary.distribution?.medium||0} hint="Score 31-60" color="#f59e0b"/>
      <StatCard icon={<AlertTriangle size={18}/>} label="High + Critical" value={(summary.distribution?.high||0)+(summary.distribution?.critical||0)} hint="Score 61-100" color="#ef4444"/>
    </div>}

    {realScores.length===0 ? (
      <div className="aihub_card" style={{textAlign:"center",padding:"40px 20px"}}>
        <Shield size={40} color="#d1d5db" style={{marginBottom:12}}/>
        <h4 style={{margin:"0 0 8px",color:"#374151"}}>No risk scores computed yet</h4>
        <p style={{color:"#9ca3af",fontSize:13,maxWidth:400,margin:"0 auto 16px"}}>
          Click "Compute Scores" to analyze employee AI behavior and generate risk scores from DLP events, tool usage, and violation history.
        </p>
      </div>
    ) : (
      <div className="aihub_two_col">
        {/* Employee List */}
        <div className="aihub_card">
          <h4 style={{margin:"0 0 12px",fontSize:14,fontWeight:700}}>Employees by Risk</h4>
          <DataTable columns={[
            {label:"Employee",render:r=><div>
              <div className="aihub_text_primary">{r.display_name}</div>
              <div className="aihub_text_muted">{r.email||r.hostname||"—"}</div>
            </div>},
            {label:"Score",render:r=><RiskLevelBadge level={r.risk_level} score={r.risk_score}/>},
            {label:"",render:r=><ScoreBar score={r.risk_score}/>},
            {label:"Sources",render:r=><div style={{display:"flex",gap:3}}>{(r.sources||[]).map(s=><Tag key={s} text={s}/>)}</div>},
            {label:"Computed",render:r=>relTime(r.risk_computed_at)},
          ]} rows={realScores} onRow={(r)=>showDetail(r.id)}/>
        </div>

        {/* Detail Panel */}
        <div>
          {detail ? (
            <div className="aihub_card">
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
                <div>
                  <h4 style={{margin:0,fontSize:16,fontWeight:700}}>{detail.profile?.display_name}</h4>
                  <div className="aihub_text_muted">{detail.profile?.email||detail.profile?.hostname||""}</div>
                </div>
                <RiskLevelBadge level={detail.profile?.risk_level} score={detail.profile?.risk_score}/>
              </div>

              <div style={{marginBottom:16}}>
                <div style={{fontSize:13,fontWeight:600,color:"#374151",marginBottom:10}}>Risk Factors</div>
                <FactorRow label="DLP Violations" factor={detail.profile?.risk_factors?.dlp_violations}/>
                <FactorRow label="Override Bypasses" factor={detail.profile?.risk_factors?.enforcement_overrides}/>
                <FactorRow label="Shadow AI Tools" factor={detail.profile?.risk_factors?.shadow_tools}/>
                <FactorRow label="Data Sensitivity" factor={detail.profile?.risk_factors?.data_sensitivity}/>
                <FactorRow label="Volume Anomaly" factor={detail.profile?.risk_factors?.volume_anomaly}/>
              </div>

              {detail.history && detail.history.length > 0 && (
                <div style={{marginBottom:16}}>
                  <div style={{fontSize:13,fontWeight:600,color:"#374151",marginBottom:8}}>Score History</div>
                  <div style={{display:"flex",gap:4,alignItems:"flex-end",height:60}}>
                    {detail.history.slice(0,30).reverse().map((h,i)=>{
                      const c=h.score<=30?"#22c55e":h.score<=60?"#f59e0b":"#ef4444";
                      return <div key={i} title={h.score+" — "+new Date(h.computed_at).toLocaleDateString()} style={{flex:1,minWidth:4,height:Math.max(h.score*0.6,2),background:c,borderRadius:2}}/>;
                    })}
                  </div>
                </div>
              )}

              {detail.recent_events && detail.recent_events.length > 0 && (
                <div>
                  <div style={{fontSize:13,fontWeight:600,color:"#374151",marginBottom:8}}>Recent Events</div>
                  {detail.recent_events.slice(0,5).map((ev,i)=>(
                    <div key={i} style={{padding:"8px 0",borderBottom:"1px solid #f3f4f6",fontSize:12}}>
                      <div style={{display:"flex",justifyContent:"space-between"}}>
                        <span style={{fontWeight:600}}>{ev.event_kind||ev.kind||"—"}</span>
                        <span className="aihub_text_muted">{relTime(ev.occurred_at)}</span>
                      </div>
                      <div className="aihub_text_muted">{ev.ai_service||"—"} · {ev.secret_class||ev.highest_severity||"—"}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="aihub_card" style={{textAlign:"center",padding:"40px 20px",color:"#9ca3af"}}>
              <Shield size={32} color="#d1d5db" style={{marginBottom:8}}/>
              <div style={{fontSize:13}}>Click an employee to see their risk breakdown</div>
            </div>
          )}
        </div>
      </div>
    )}
  </div>);
}

// PAGE ROUTER
// ═══════════════════════════════════════════════════════════════════════════════
// ── AI Registry View ──────────────────────────────────────────────────────

const REGISTRY_API = "/api/v1/registry";

const STATUS_COLORS = { approved: "#22c55e", blocked: "#ef4444", unknown: "#f59e0b" };
const CATEGORY_ICONS = {
  'desktop-app': '💻', 'ide-assistant': '🧩', 'web-service': '🌐', 'autonomous-agent': '🤖',
  'chat-agent': '💬', 'mcp-server': '🔌', 'local-model': '🏠', 'ml-platform': '☁️',
  'automation': '⚙️', 'embedded-agent': '📎', 'marketplace-app': '🏪', 'agent-config': '📁', 'unknown': '❓',
};

function RegistryStatusBadge({ status }) {
  const label = status === 'approved' ? 'Allowed' : status === 'blocked' ? 'Blocked' : 'Unreviewed';
  const c = STATUS_COLORS[status] || "#f59e0b";
  return <span style={{display:"inline-flex",alignItems:"center",gap:4,padding:"2px 10px",borderRadius:8,fontSize:11,fontWeight:700,background:c+"14",color:c,border:"1px solid "+c+"30"}}>{label}</span>;
}

function RegistryToggle({ status, onChange }) {
  const isUnreviewed = status === 'unknown' || status === 'restricted';
  const isAllowed = status === 'approved';
  const isBlocked = status === 'blocked';

  if (isUnreviewed) {
    // First time — show both options side by side
    return (<div style={{display:"flex",alignItems:"center",gap:8}}>
      <button onClick={()=>onChange('approved')} style={{padding:"6px 16px",borderRadius:8,fontSize:12,fontWeight:600,border:"1px solid #22c55e40",background:"#22c55e14",color:"#22c55e",cursor:"pointer"}}>Allow</button>
      <span style={{fontSize:11,color:"#f59e0b",fontWeight:600}}>Unreviewed</span>
      <button onClick={()=>onChange('blocked')} style={{padding:"6px 16px",borderRadius:8,fontSize:12,fontWeight:600,border:"1px solid #ef444440",background:"#ef444414",color:"#ef4444",cursor:"pointer"}}>Block</button>
    </div>);
  }

  // After first decision — simple toggle between allowed and blocked
  return (<div style={{display:"flex",alignItems:"center",gap:10}}>
    <span style={{fontSize:12,fontWeight:isAllowed?700:400,color:isAllowed?"#22c55e":"#9ca3af"}}>Allowed</span>
    <div onClick={()=>onChange(isAllowed?'blocked':'approved')}
      style={{width:44,height:24,borderRadius:12,background:isAllowed?"#22c55e":"#ef4444",cursor:"pointer",position:"relative",transition:"background 0.2s"}}>
      <div style={{width:18,height:18,borderRadius:9,background:"#fff",position:"absolute",top:3,left:isAllowed?3:23,transition:"left 0.2s",boxShadow:"0 1px 3px rgba(0,0,0,0.2)"}}/>
    </div>
    <span style={{fontSize:12,fontWeight:isBlocked?700:400,color:isBlocked?"#ef4444":"#9ca3af"}}>Blocked</span>
  </div>);
}

function AIRegistryView() {
  const [allItems,setAllItems]=useState(null);
  const [summary,setSummary]=useState(null);
  const [err,setErr]=useState(null);
  const [search,setSearch]=useState("");
  const [filterStatus,setFilterStatus]=useState("");
  const [filterCategory,setFilterCategory]=useState("");
  const [filterRisk,setFilterRisk]=useState("");
  const [hideInactive,setHideInactive]=useState(true);
  const [selected,setSelected]=useState(null);

  // Fetch ALL data once on mount — filter client-side for instant response
  const loadAll=()=>{
    Promise.all([
      fetch(REGISTRY_API).then(r=>r.json()),
      fetch(`${REGISTRY_API}/summary`).then(r=>r.json()),
    ]).then(([r,s])=>{setAllItems(r);setSummary(s);}).catch(x=>setErr(x.message));
  };
  useEffect(loadAll,[]);

  const updateStatus=async(id,status,productName)=>{
    await fetch(`${REGISTRY_API}/${encodeURIComponent(id)}/status`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({status,product_name:productName})});
    loadAll();
  };

  if(err) return <Err msg={err}/>;
  if(!allItems) return <Loading/>;

  // Client-side filtering — instant, no network calls
  const q=search.toLowerCase();
  const activeCount=allItems.filter(r=>(r.activity?.total||0)>0).length;
  const inactiveCount=allItems.length-activeCount;
  const items=allItems.filter(r=>{
    if(hideInactive && (r.activity?.total||0)===0) return false;
    if(filterStatus) {
      if(filterStatus==='unknown') { if(r.status!=='unknown'&&r.status!=='restricted') return false; }
      else if(r.status!==filterStatus) return false;
    }
    if(filterCategory && r.category!==filterCategory) return false;
    if(filterRisk && r.risk_level!==filterRisk) return false;
    if(q && !(r.name||'').toLowerCase().includes(q) && !(r.vendor||'').toLowerCase().includes(q) && !(r.owner||'').toLowerCase().includes(q) && !(r.platform||'').toLowerCase().includes(q) && !(r.category||'').toLowerCase().includes(q)) return false;
    return true;
  }).sort((a,b)=>(b.activity?.total||0)-(a.activity?.total||0));

  const categories=[...new Set(allItems.map(i=>i.category).filter(Boolean))].sort();
  const detailItem=selected?allItems.find(i=>i.id===selected):null;

  return (<div>
    <SectionHeader title="AI & Agent Registry" hint="Unified catalog of every AI system across your organization"/>

    {/* Summary Cards — count from visible pool (respects hide-inactive toggle) */}
    {(()=>{
      const pool=hideInactive?allItems.filter(r=>(r.activity?.total||0)>0):allItems;
      return <div className="aihub_stat_grid" style={{gridTemplateColumns:"repeat(4, 1fr)"}}>
        <StatCard icon={<Monitor size={18}/>} label="AI Systems" value={pool.length} hint={hideInactive?`+${inactiveCount} inactive`:`${activeCount} active`} color="#0044cc" onClick={()=>setHideInactive(!hideInactive)}/>
        <StatCard icon={<Shield size={18}/>} label="Allowed" value={pool.filter(i=>i.status==='approved').length} color="#22c55e" onClick={()=>setFilterStatus(filterStatus==='approved'?'':'approved')}/>
        <StatCard icon={<AlertTriangle size={18}/>} label="Unreviewed" value={pool.filter(i=>i.status==='unknown'||i.status==='restricted').length} hint="Need decision" color="#f59e0b" onClick={()=>setFilterStatus(filterStatus==='unknown'?'':'unknown')}/>
        <StatCard icon={<AlertTriangle size={18}/>} label="Blocked" value={pool.filter(i=>i.status==='blocked').length} color="#ef4444" onClick={()=>setFilterStatus(filterStatus==='blocked'?'':'blocked')}/>
      </div>;
    })()}

    {/* Filters */}
    <div className="aihub_card" style={{display:"flex",flexWrap:"wrap",gap:10,alignItems:"center",padding:12,marginBottom:16}}>
      <div className="aihub_search_box" style={{flex:1,minWidth:200}}>
        <Search size={14}/><input placeholder="Search name, vendor, owner..." value={search} onChange={e=>setSearch(e.target.value)} style={{border:"none",outline:"none",flex:1,fontSize:13}}/>
      </div>
      <select value={filterStatus} onChange={e=>setFilterStatus(e.target.value)} style={{padding:"6px 10px",border:"1px solid #e5e7eb",borderRadius:8,fontSize:12}}>
        <option value="">All Statuses</option>
        <option value="approved">Allowed</option>
        <option value="unknown">Unreviewed</option>
        <option value="blocked">Blocked</option>
      </select>
      <select value={filterCategory} onChange={e=>setFilterCategory(e.target.value)} style={{padding:"6px 10px",border:"1px solid #e5e7eb",borderRadius:8,fontSize:12}}>
        <option value="">All Categories</option>
        {categories.map(c=><option key={c} value={c}>{c}</option>)}
      </select>
      <select value={filterRisk} onChange={e=>setFilterRisk(e.target.value)} style={{padding:"6px 10px",border:"1px solid #e5e7eb",borderRadius:8,fontSize:12}}>
        <option value="">All Risk Levels</option>
        <option value="low">Low</option>
        <option value="medium">Medium</option>
        <option value="high">High</option>
        <option value="critical">Critical</option>
      </select>
      <label style={{display:"flex",alignItems:"center",gap:6,fontSize:12,color:"#6b7280",cursor:"pointer"}}>
        <input type="checkbox" checked={!hideInactive} onChange={e=>setHideInactive(!e.target.checked)}/> Show inactive ({inactiveCount})
      </label>
      <div style={{fontSize:12,color:"#9ca3af",marginLeft:"auto"}}>{items.length} results</div>
    </div>

    <div className="aihub_two_col">
      {/* Registry Table */}
      <div className="aihub_card" style={{overflow:"auto"}}>
        <DataTable columns={[
          {label:"AI System",render:r=><div style={{display:"flex",alignItems:"center",gap:8}}>
            <span style={{fontSize:18}}>{CATEGORY_ICONS[r.category]||'❓'}</span>
            <div>
              <div className="aihub_text_primary">{r.name}</div>
              <div className="aihub_text_muted">{r.vendor||""}{r.platform?" · "+r.platform:""}</div>
            </div>
          </div>},
          {label:"Status",render:r=><RegistryStatusBadge status={r.status}/>},
          {label:"Risk",render:r=>r.risk_score!=null?<span style={{whiteSpace:"nowrap"}}><RiskLevelBadge level={r.risk_level} score={r.risk_score}/></span>:<span className="aihub_text_muted">—</span>},
          {label:"Owner",render:r=><div style={{whiteSpace:"nowrap"}}>
            <div style={{fontSize:12}}>{r.owner||"—"}</div>
            {r.is_orphaned&&<span style={{fontSize:10,color:"#ef4444",fontWeight:600}}>⚠ Orphaned</span>}
          </div>},
          {label:"Activity",render:r=><div style={{textAlign:"right",whiteSpace:"nowrap"}}>
            <div style={{fontSize:13,fontWeight:600}}>{r.activity?.total?.toLocaleString()||0}</div>
            <div className="aihub_text_muted">{r.activity?.last_active?relTime(r.activity.last_active):"never"}</div>
          </div>,right:true},
          {label:"Source",render:r=><Tag text={r.source==="governance"?"Gov":r.source==="endpoint_scan"?"Scan":"Platform"} color={r.source==="governance"?"#8b5cf6":r.source==="endpoint_scan"?"#0044cc":"#6b7280"}/>},
        ]} rows={items} onRow={r=>setSelected(r.id)} empty="No AI systems found matching your filters."/>
      </div>

      {/* Detail Panel */}
      <div>
        {detailItem ? (
          <div className="aihub_card">
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:16}}>
              <div>
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
                  <span style={{fontSize:24}}>{CATEGORY_ICONS[detailItem.category]||'❓'}</span>
                  <h4 style={{margin:0,fontSize:16,fontWeight:700}}>{detailItem.name}</h4>
                </div>
                <div className="aihub_text_muted">{detailItem.vendor}{detailItem.platform?" · "+detailItem.platform:""}</div>
                {detailItem.description&&<div style={{fontSize:12,color:"#374151",marginTop:6}}>{detailItem.description}</div>}
              </div>
              <RegistryStatusBadge status={detailItem.status}/>
            </div>

            {/* Allow / Block Toggle */}
            <div style={{marginBottom:16}}>
              <RegistryToggle status={detailItem.status} onChange={(s)=>updateStatus(detailItem.id,s,detailItem.name)}/>
            </div>

            {/* Info Grid */}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:16,fontSize:12}}>
              <div><span style={{color:"#9ca3af"}}>Category:</span> <span style={{fontWeight:600}}>{detailItem.category}</span></div>
              <div><span style={{color:"#9ca3af"}}>Lifecycle:</span> <span style={{fontWeight:600}}>{detailItem.lifecycle}</span></div>
              <div><span style={{color:"#9ca3af"}}>Owner:</span> <span style={{fontWeight:600}}>{detailItem.owner||"—"}</span></div>
              <div><span style={{color:"#9ca3af"}}>Owner Email:</span> <span style={{fontWeight:600}}>{detailItem.owner_email||"—"}</span></div>
              <div><span style={{color:"#9ca3af"}}>Model:</span> <span style={{fontWeight:600}}>{detailItem.model||"—"}</span></div>
              <div><span style={{color:"#9ca3af"}}>Source:</span> <Tag text={detailItem.source_detail||detailItem.source}/></div>
              <div><span style={{color:"#9ca3af"}}>First Seen:</span> <span>{detailItem.first_seen?relTime(detailItem.first_seen):"—"}</span></div>
              <div><span style={{color:"#9ca3af"}}>Last Active:</span> <span>{detailItem.last_active?relTime(detailItem.last_active):"—"}</span></div>
              {detailItem.machine_count&&<div><span style={{color:"#9ca3af"}}>Machines:</span> <span style={{fontWeight:600}}>{detailItem.machine_count}</span></div>}
              {detailItem.is_orphaned&&<div style={{gridColumn:"1/-1",color:"#ef4444",fontWeight:600}}>⚠ Owner account is disabled — this system is orphaned</div>}
            </div>

            {/* Risk */}
            {detailItem.risk_score!=null&&(
              <div style={{marginBottom:16}}>
                <div style={{fontSize:13,fontWeight:600,color:"#374151",marginBottom:6}}>Risk Assessment</div>
                <RiskLevelBadge level={detailItem.risk_level} score={detailItem.risk_score}/>
                {detailItem.risk_factors?.length>0&&<div style={{marginTop:8}}>
                  {detailItem.risk_factors.map((f,i)=><div key={i} style={{fontSize:11,color:"#6b7280",marginBottom:2}}>• {f.description||f.signal}</div>)}
                </div>}
              </div>
            )}

            {/* Data Access / Connectors */}
            {detailItem.data_access?.length>0&&(
              <div style={{marginBottom:16}}>
                <div style={{fontSize:13,fontWeight:600,color:"#374151",marginBottom:6}}>Data Access</div>
                <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
                  {detailItem.data_access.map((d,i)=><Tag key={i} text={d} color="#ef4444"/>)}
                </div>
              </div>
            )}

            {/* Permissions */}
            {detailItem.permissions?.length>0&&(
              <div style={{marginBottom:16}}>
                <div style={{fontSize:13,fontWeight:600,color:"#374151",marginBottom:6}}>Permissions ({detailItem.permissions.length})</div>
                <div style={{maxHeight:100,overflowY:"auto",fontSize:11,color:"#6b7280"}}>
                  {detailItem.permissions.map((p,i)=><div key={i}>• {typeof p==='string'?p:p.scope||p.name||JSON.stringify(p)}</div>)}
                </div>
              </div>
            )}

            {/* Activity */}
            <div>
              <div style={{fontSize:13,fontWeight:600,color:"#374151",marginBottom:6}}>Activity</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,fontSize:12}}>
                <div style={{background:"#f9fafb",padding:10,borderRadius:8,textAlign:"center"}}>
                  <div style={{fontSize:18,fontWeight:700}}>{(detailItem.activity?.total||0).toLocaleString()}</div>
                  <div className="aihub_text_muted">Total Events</div>
                </div>
                <div style={{background:"#f9fafb",padding:10,borderRadius:8,textAlign:"center"}}>
                  <div style={{fontSize:18,fontWeight:700}}>{detailItem.activity?.unique_users||0}</div>
                  <div className="aihub_text_muted">Users</div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="aihub_card" style={{textAlign:"center",padding:"40px 20px",color:"#9ca3af"}}>
            <Monitor size={32} color="#d1d5db" style={{marginBottom:8}}/>
            <div style={{fontSize:13}}>Click an AI system to see its full details</div>
          </div>
        )}
      </div>
    </div>
  </div>);
}

// ── Access Requests View ──────────────────────────────────────────────────

const ACCESS_API = "/api/v1/access-requests";
const EXCEPTION_API = "/api/v1/access-exceptions";

function AccessRequestsView() {
  const [requests,setRequests]=useState(null);
  const [exceptions,setExceptions]=useState(null);
  const [err,setErr]=useState(null);
  const [tab,setTab]=useState("pending");
  const [approving,setApproving]=useState(null); // request id being approved
  const [expiryMode,setExpiryMode]=useState("hours"); // "hours" or "date"
  const [expiryHours,setExpiryHours]=useState("24");
  const [expiryDate,setExpiryDate]=useState("");
  const [reviewNote,setReviewNote]=useState("");

  const loadAll=()=>{
    Promise.all([
      fetch(ACCESS_API).then(r=>r.json()),
      fetch(EXCEPTION_API).then(r=>r.json()),
    ]).then(([r,e])=>{setRequests(r);setExceptions(e);}).catch(x=>setErr(x.message));
  };
  useEffect(loadAll,[]);

  const approve=async(id)=>{
    const body={note:reviewNote};
    if(expiryMode==="hours") body.expires_in_hours=Number(expiryHours);
    else body.expires_at=expiryDate;
    const res=await fetch(`${ACCESS_API}/${id}/approve`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
    if(!res.ok){const e=await res.json().catch(()=>({}));alert(e.error||"Failed");return;}
    setApproving(null);setReviewNote("");loadAll();
  };

  const reject=async(id)=>{
    await fetch(`${ACCESS_API}/${id}/reject`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({note:reviewNote})});
    setApproving(null);setReviewNote("");loadAll();
  };

  const revoke=async(id)=>{
    if(!confirm("Revoke this access? The tool will be blocked again for this employee.")) return;
    await fetch(`${EXCEPTION_API}/${id}`,{method:"DELETE"});
    loadAll();
  };

  if(err) return <Err msg={err}/>;
  if(!requests) return <Loading/>;

  const pending=requests.filter(r=>r.status==="pending");
  const history=requests.filter(r=>r.status!=="pending");

  const tabs=[
    {id:"pending",label:`Pending (${pending.length})`},
    {id:"active",label:`Active Exceptions (${(exceptions||[]).length})`},
    {id:"history",label:"History"},
  ];

  return (<div>
    <SectionHeader title="Tool Access Requests" hint="Employees request temporary access to blocked AI tools. Approve with a mandatory expiry date."/>

    {/* Summary */}
    <div className="aihub_stat_grid" style={{gridTemplateColumns:"repeat(3, 1fr)"}}>
      <StatCard icon={<Clock size={18}/>} label="Pending" value={pending.length} hint="Awaiting your review" color="#f59e0b"/>
      <StatCard icon={<Shield size={18}/>} label="Active Exceptions" value={(exceptions||[]).length} hint="Temporary access granted" color="#22c55e"/>
      <StatCard icon={<Activity size={18}/>} label="Total Requests" value={requests.length} color="#0044cc"/>
    </div>

    {/* Tabs */}
    <div style={{display:"flex",gap:2,marginBottom:16,borderBottom:"2px solid #f3f4f6"}}>
      {tabs.map(t=><button key={t.id} onClick={()=>setTab(t.id)}
        style={{padding:"8px 18px",fontSize:13,fontWeight:tab===t.id?700:500,border:"none",borderBottom:tab===t.id?"2px solid #0044cc":"2px solid transparent",
          background:"none",color:tab===t.id?"#0044cc":"#6b7280",cursor:"pointer",marginBottom:-2}}>{t.label}</button>)}
    </div>

    {/* Pending Tab */}
    {tab==="pending"&&(<div>
      {pending.length===0?(
        <div className="aihub_card" style={{textAlign:"center",padding:"40px 20px"}}>
          <Shield size={40} color="#d1d5db" style={{marginBottom:12}}/>
          <h4 style={{margin:"0 0 8px",color:"#374151"}}>No pending requests</h4>
          <p style={{color:"#9ca3af",fontSize:13}}>When employees request access to a blocked tool, their requests appear here.</p>
        </div>
      ):(
        <div className="aihub_card">
          {pending.map(r=>(<div key={r.id} style={{padding:"16px 0",borderBottom:"1px solid #f3f4f6"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
              <div>
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
                  <span style={{fontSize:16,fontWeight:700}}>{r.tool_name||r.tool_host}</span>
                  {r.tool_vendor&&<Tag text={r.tool_vendor}/>}
                </div>
                <div className="aihub_text_muted" style={{marginBottom:6}}>
                  Requested by <strong>{r.employee_name}</strong> · {relTime(r.submitted_at)}
                </div>
                {r.reason&&<div style={{fontSize:13,color:"#374151",background:"#f9fafb",padding:"8px 12px",borderRadius:8,marginBottom:8}}>"{r.reason}"</div>}
              </div>
            </div>

            {approving===r.id?(
              <div style={{background:"#f0f9ff",borderRadius:10,padding:14,marginTop:8}}>
                <div style={{fontSize:13,fontWeight:600,marginBottom:8}}>Set expiry (required)</div>
                <div style={{display:"flex",gap:8,marginBottom:10}}>
                  <button onClick={()=>setExpiryMode("hours")} style={{padding:"5px 12px",borderRadius:6,fontSize:12,border:"1px solid",cursor:"pointer",background:expiryMode==="hours"?"#0044cc14":"#fff",color:expiryMode==="hours"?"#0044cc":"#6b7280",borderColor:expiryMode==="hours"?"#0044cc40":"#e5e7eb"}}>Hours</button>
                  <button onClick={()=>setExpiryMode("date")} style={{padding:"5px 12px",borderRadius:6,fontSize:12,border:"1px solid",cursor:"pointer",background:expiryMode==="date"?"#0044cc14":"#fff",color:expiryMode==="date"?"#0044cc":"#6b7280",borderColor:expiryMode==="date"?"#0044cc40":"#e5e7eb"}}>Date</button>
                </div>
                {expiryMode==="hours"?(
                  <div style={{display:"flex",gap:6,alignItems:"center",marginBottom:10}}>
                    {["4","8","24","72","168"].map(h=>
                      <button key={h} onClick={()=>setExpiryHours(h)} style={{padding:"4px 10px",borderRadius:6,fontSize:11,border:"1px solid",cursor:"pointer",background:expiryHours===h?"#0044cc14":"#fff",color:expiryHours===h?"#0044cc":"#6b7280",borderColor:expiryHours===h?"#0044cc40":"#e5e7eb"}}>{h==="168"?"7 days":h+"h"}</button>
                    )}
                    <input type="number" value={expiryHours} onChange={e=>setExpiryHours(e.target.value)} style={{width:60,padding:"4px 8px",border:"1px solid #e5e7eb",borderRadius:6,fontSize:12}} min="1"/>
                    <span style={{fontSize:12,color:"#6b7280"}}>hours</span>
                  </div>
                ):(
                  <input type="datetime-local" value={expiryDate} onChange={e=>setExpiryDate(e.target.value)} style={{padding:"6px 10px",border:"1px solid #e5e7eb",borderRadius:8,fontSize:12,marginBottom:10}}/>
                )}
                <input value={reviewNote} onChange={e=>setReviewNote(e.target.value)} placeholder="Note (optional)" style={{width:"100%",padding:"6px 10px",border:"1px solid #e5e7eb",borderRadius:8,fontSize:12,marginBottom:10,boxSizing:"border-box"}}/>
                <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
                  <button onClick={()=>{setApproving(null);setReviewNote("");}} style={{padding:"6px 16px",borderRadius:8,border:"1px solid #e5e7eb",background:"#fff",cursor:"pointer",fontSize:12}}>Cancel</button>
                  <button onClick={()=>reject(r.id)} style={{padding:"6px 16px",borderRadius:8,border:"1px solid #ef444440",background:"#ef444414",color:"#ef4444",cursor:"pointer",fontSize:12,fontWeight:600}}>Reject</button>
                  <button onClick={()=>approve(r.id)} style={{padding:"6px 16px",borderRadius:8,border:"none",background:"#22c55e",color:"#fff",cursor:"pointer",fontSize:12,fontWeight:600}}>Approve</button>
                </div>
              </div>
            ):(
              <div style={{display:"flex",gap:8,marginTop:8}}>
                <button onClick={()=>setApproving(r.id)} style={{padding:"6px 16px",borderRadius:8,border:"none",background:"#0044cc",color:"#fff",cursor:"pointer",fontSize:12,fontWeight:600}}>Review</button>
                <button onClick={()=>reject(r.id)} style={{padding:"6px 16px",borderRadius:8,border:"1px solid #ef444440",background:"#ef444414",color:"#ef4444",cursor:"pointer",fontSize:12,fontWeight:600}}>Reject</button>
              </div>
            )}
          </div>))}
        </div>
      )}
    </div>)}

    {/* Active Exceptions Tab */}
    {tab==="active"&&(<div className="aihub_card">
      <DataTable columns={[
        {label:"Tool",render:r=><div className="aihub_text_primary">{r.tool_name||r.tool_host}</div>},
        {label:"Machine",render:r=><Mono>{r.machine_id?.slice(0,12)}</Mono>},
        {label:"Granted",render:r=>relTime(r.granted_at)},
        {label:"Expires",render:r=>{
          const d=new Date(r.expires_at);
          const ms=d-Date.now();
          if(ms<=0) return <Badge text="Expired" color="#ef4444"/>;
          const h=Math.floor(ms/3600000);
          if(h<24) return <Badge text={h+"h left"} color="#f59e0b"/>;
          return <Badge text={Math.floor(h/24)+"d left"} color="#22c55e"/>;
        }},
        {label:"",render:r=><button onClick={()=>revoke(r.request_id)} style={{padding:"4px 12px",borderRadius:6,border:"1px solid #ef444440",background:"#ef444414",color:"#ef4444",cursor:"pointer",fontSize:11,fontWeight:600}}>Revoke</button>},
      ]} rows={exceptions||[]} empty="No active access exceptions."/>
    </div>)}

    {/* History Tab */}
    {tab==="history"&&(<div className="aihub_card">
      <DataTable columns={[
        {label:"Tool",render:r=><div className="aihub_text_primary">{r.tool_name||r.tool_host}</div>},
        {label:"Employee",render:r=>r.employee_name||"—"},
        {label:"Reason",render:r=><div style={{fontSize:12,maxWidth:200,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.reason||"—"}</div>},
        {label:"Status",render:r=><Badge text={r.status} color={r.status==="approved"?"#22c55e":r.status==="rejected"?"#ef4444":r.status==="revoked"?"#f59e0b":"#9ca3af"}/>},
        {label:"Reviewed",render:r=>r.reviewed_at?relTime(r.reviewed_at):"—"},
        {label:"Expires",render:r=>r.expires_at?new Date(r.expires_at).toLocaleDateString():"—"},
        {label:"Note",render:r=><div className="aihub_text_muted" style={{fontSize:11}}>{r.review_note||"—"}</div>},
      ]} rows={history} empty="No request history yet."/>
    </div>)}
  </div>);
}

// ═══════════════════════════════════════════════════════════════════════════════
// DEVELOPER SDK — Projects, API Keys, Traces
// ═══════════════════════════════════════════════════════════════════════════════
function DeveloperSDKView() {
  const [stats, setStats] = useState(null);
  const [projects, setProjects] = useState([]);
  const [events, setEvents] = useState([]);
  const [selectedProject, setSelectedProject] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newLang] = useState("javascript");
  const [createdKey, setCreatedKey] = useState(null);
  const [loading, setLoading] = useState(true);
  const [snippetLang, setSnippetLang] = useState("javascript");
  const [showCode, setShowCode] = useState(false);

  const load = async () => {
    try {
      const [s, p] = await Promise.all([
        fetch("/api/v1/sdk/stats").then(r => r.json()),
        fetch("/api/v1/sdk/projects").then(r => r.json()),
      ]);
      setStats(s);
      setProjects(p);
    } catch {}
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (!selectedProject) { setEvents([]); return; }
    fetch(`/api/v1/sdk/events?project_id=${selectedProject.id}&limit=50`).then(r => r.json()).then(setEvents).catch(() => {});
  }, [selectedProject]);

  const createProject = async () => {
    if (!newName.trim()) return;
    const res = await fetch("/api/v1/sdk/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: newName, language: newLang, description: newDesc }),
    });
    const project = await res.json();
    setCreatedKey(project);
    setShowCreate(false);
    setNewName("");
    setNewDesc("");
    load();
  };

  const deleteProject = async (id) => {
    if (!confirm("Delete this project? API key will stop working.")) return;
    await fetch(`/api/v1/sdk/projects/${id}`, { method: "DELETE" });
    setSelectedProject(null);
    setCreatedKey(null);
    load();
  };

  const serverUrl = window.location.origin.includes(":3000")
    ? window.location.origin.replace(":3000", ":8787")
    : window.location.origin;

  const installCmds = {
    javascript: `npm install @cloudfuze/sdk`,
    typescript: `npm install @cloudfuze/sdk`,
    python: `pip install cloudfuze-sdk`,
    go: `go get github.com/cloudfuze/sdk-go`,
  };

  const connectSnippets = (apiKey, appName) => ({
    javascript: `require('@cloudfuze/sdk').init({
  serverUrl: '${serverUrl}',
  apiKey: '${apiKey}',
  appName: '${appName}',
});`,

    typescript: `import { init } from '@cloudfuze/sdk';

init({
  serverUrl: '${serverUrl}',
  apiKey: '${apiKey}',
  appName: '${appName}',
});`,

    python: `from cloudfuze import init

init(
    server_url="${serverUrl}",
    api_key="${apiKey}",
    app_name="${appName}",
)`,

    go: `import "github.com/cloudfuze/sdk-go"

cloudfuze.Init(cloudfuze.Config{
    ServerURL: "${serverUrl}",
    APIKey:    "${apiKey}",
    AppName:   "${appName}",
})`,
  });

  const copyText = (text) => {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.cssText = "position:fixed;left:-9999px";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
  };

  const CodeBox = ({ code }) => (
    <div style={{ position: "relative" }}>
      <div style={{ background: "#1e293b", color: "#e2e8f0", borderRadius: 8, padding: 16, fontFamily: "ui-monospace, monospace", fontSize: 11, lineHeight: 1.6, overflowX: "auto", whiteSpace: "pre" }}>{code}</div>
      <CopyIcon onClick={() => copyText(code)} />
    </div>
  );

  const CopyIcon = ({ onClick }) => {
    const [ok, setOk] = useState(false);
    return (
      <svg onClick={() => { onClick(); setOk(true); setTimeout(() => setOk(false), 2000); }}
        width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={ok ? "#22c55e" : "#94a3b8"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
        style={{ position: "absolute", top: 10, right: 10, cursor: "pointer", transition: "stroke 0.2s" }}>
        {ok ? <polyline points="20 6 9 17 4 12" /> : <><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></>}
      </svg>
    );
  };

  const langLabels = { javascript: "JavaScript", typescript: "TypeScript", python: "Python", go: "Go" };

  if (loading) return <Loading />;

  return (
    <div>
      {/* Stats */}
      <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
        <StatCard icon={<Server size={18} />} label="Projects" value={stats?.total_projects || 0} hint="Connected" color="#2563eb" />
        <StatCard icon={<Activity size={18} />} label="Total Traces" value={stats?.total_events || 0} hint="All time" color="#8b5cf6" />
        <StatCard icon={<Shield size={18} />} label="Active (24h)" value={stats?.active_projects || 0} hint="Sending data" color="#22c55e" />
        <StatCard icon={<Clock size={18} />} label="Total Cost" value={fmtUsd(stats?.total_cost_usd)} hint="All time" color="#f59e0b" />
      </div>

      {/* Created key banner */}
      {createdKey && (
        <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 12, padding: 20, marginBottom: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={{ fontWeight: 700, fontSize: 16, color: "#166534" }}>Project "{createdKey.name}" created!</div>
            <button onClick={() => setCreatedKey(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "#6b7280", fontSize: 18 }}>×</button>
          </div>
          <div style={{ fontSize: 13, color: "#166534", marginBottom: 6 }}>Your API key:</div>
          <CodeBox code={createdKey.api_key} />
          <div className="aihub_text_muted" style={{ fontSize: 11, marginTop: 6, marginBottom: 14 }}>You can always view the integration code from the project's detail page.</div>
        </div>
      )}

      {/* Projects list + Create button */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <SectionHeader title="SDK Projects" hint="Each project gets a unique API key for your application" />
        <button onClick={() => setShowCreate(true)}
          style={{ background: "#2563eb", color: "#fff", border: "none", borderRadius: 8, padding: "10px 20px", fontSize: 14, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
          <Plus size={14} /> New Project
        </button>
      </div>

      {/* Create project form */}
      {showCreate && (
        <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: 20, marginBottom: 16 }}>
          <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 12 }}>Create New Project</div>
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 4 }}>Project Name *</div>
            <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="e.g. customer-support-bot"
              style={{ width: "100%", padding: "8px 12px", border: "1px solid #d1d5db", borderRadius: 8, fontSize: 13 }} />
          </div>
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 4 }}>Description (optional)</div>
            <input value={newDesc} onChange={e => setNewDesc(e.target.value)} placeholder="What does this app do?"
              style={{ width: "100%", padding: "8px 12px", border: "1px solid #d1d5db", borderRadius: 8, fontSize: 13 }} />
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={createProject} disabled={!newName.trim()}
              style={{ background: newName.trim() ? "#2563eb" : "#d1d5db", color: "#fff", border: "none", borderRadius: 8, padding: "8px 20px", fontSize: 13, fontWeight: 600, cursor: newName.trim() ? "pointer" : "default" }}>
              Create & Generate Key
            </button>
            <button onClick={() => setShowCreate(false)}
              style={{ background: "#fff", color: "#6b7280", border: "1px solid #d1d5db", borderRadius: 8, padding: "8px 20px", fontSize: 13, cursor: "pointer" }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Projects table */}
      {!selectedProject && (
        <DataTable
          columns={[
            { label: "Project", render: r => <div><div className="aihub_text_primary">{r.name}</div>{r.description && <div className="aihub_text_muted" style={{ fontSize: 11 }}>{r.description}</div>}</div> },
            { label: "Language", render: r => <Tag text={r.language || "js"} /> },
            { label: "Status", render: r => <Badge text={r.status} color={r.status === "active" ? "#22c55e" : "#9ca3af"} /> },
            { label: "Events", key: "total_events", right: true },
            { label: "Cost", render: r => fmtUsd(r.total_cost_usd), right: true },
            { label: "Last Event", render: r => relTime(r.last_event_at) },
            { label: "Created", render: r => relTime(r.created_at) },
            { label: "", render: r => <button onClick={e => { e.stopPropagation(); deleteProject(r.id); }} style={{ background: "none", border: "none", color: "#ef4444", cursor: "pointer", fontSize: 12 }}>Delete</button> },
          ]}
          rows={projects}
          empty="No projects yet. Click 'New Project' to create one and get your API key."
          onRow={r => setSelectedProject(r)}
        />
      )}

      {/* Project detail — events */}
      {selectedProject && (
        <div>
          <button onClick={() => setSelectedProject(null)} style={{ background: "none", border: "none", color: "#2563eb", cursor: "pointer", fontSize: 13, marginBottom: 12, padding: 0 }}>← Back to projects</button>
          <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
              <div>
                <h3 style={{ margin: 0 }}>{selectedProject.name}</h3>
                <div className="aihub_text_muted" style={{ fontSize: 12 }}>{selectedProject.description || "No description"}</div>
              </div>
              <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                <button onClick={() => setShowCode(!showCode)}
                  style={{ background: showCode ? "#1e293b" : "#fff", color: showCode ? "#fff" : "#374151", border: "1px solid #d1d5db", borderRadius: 8, padding: "8px 16px", fontSize: 13, fontWeight: 500, cursor: "pointer" }}>
                  {showCode ? "Hide Code" : "< > Code"}
                </button>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 20, fontWeight: 700 }}>{selectedProject.total_events}</div>
                  <div className="aihub_text_muted" style={{ fontSize: 11 }}>total events</div>
                </div>
              </div>
            </div>

            {/* Code snippet */}
            {showCode && (
              <div style={{ marginBottom: 20 }}>
                <div style={{ display: "flex", gap: 4, marginBottom: 14 }}>
                  {Object.entries(langLabels).map(([k, v]) => (
                    <button key={k} onClick={() => setSnippetLang(k)}
                      style={{ padding: "5px 12px", border: "1px solid " + (snippetLang === k ? "#2563eb" : "#e5e7eb"), borderRadius: 6, background: snippetLang === k ? "#eff6ff" : "#fff", color: snippetLang === k ? "#2563eb" : "#6b7280", fontSize: 11, fontWeight: snippetLang === k ? 600 : 400, cursor: "pointer" }}>
                      {v}
                    </button>
                  ))}
                </div>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 6 }}>1. Install the SDK</div>
                <CodeBox code={installCmds[snippetLang]} />
                <div style={{ fontSize: 12, fontWeight: 600, color: "#374151", marginTop: 14, marginBottom: 6 }}>2. Add this at the top of your app (before any AI imports)</div>
                <CodeBox code={connectSnippets(selectedProject.api_key || "cfsk_••••••••••••", selectedProject.name)[snippetLang]} />
                <div className="aihub_text_muted" style={{ fontSize: 11, marginTop: 10 }}>That's it. All AI API calls from this app will appear in the traces above automatically.</div>
              </div>
            )}

            <SectionHeader title="Recent Traces" hint="AI API calls captured from this project" />
            <DataTable
              columns={[
                { label: "Time", render: r => <span style={{ fontSize: 12 }}>{relTime(r.occurred_at)}</span> },
                { label: "Type", render: r => <Tag text={r.type} /> },
                { label: "Provider", render: r => <Tag text={r.provider || "—"} color={r.provider === "openai" ? "#10a37f" : r.provider === "anthropic" ? "#d97706" : "#6366f1"} /> },
                { label: "Model", render: r => <span style={{ fontSize: 12 }}>{r.model || "—"}</span> },
                { label: "Tokens", render: r => fmtTokens((r.prompt_tokens || 0) + (r.completion_tokens || 0)), right: true },
                { label: "Cost", render: r => fmtUsd(r.total_cost_usd), right: true },
                { label: "Duration", render: r => r.duration_ms ? r.duration_ms + "ms" : "—", right: true },
                { label: "Status", render: r => <Badge text={r.status || "ok"} color={r.status === "error" ? "#ef4444" : "#22c55e"} /> },
              ]}
              rows={events}
              empty="No events yet. Integrate the SDK and make an AI API call."
            />
          </div>
        </div>
      )}
    </div>
  );
// ═══════════════════════════════════════════════════════════════════════════════
// 9. CLAUDE USAGE — every Claude surface in one place. Prompt counts are measured
//    everywhere; tokens/cost are MEASURED for Claude Code (the CLI reports them)
//    and ESTIMATED elsewhere. The two are never added together.
// ═══════════════════════════════════════════════════════════════════════════════
function ClaudeUsageView() {
  const [data,setData]=useState(null),[e,setE]=useState(null),[sel,setSel]=useState(null);
  useEffect(()=>{
    apiFetch("/claude-usage").then(d=>{ setData(d); if(d.surfaces?.length) setSel(d.surfaces[0].surface); }).catch(x=>setE(x.message));
  },[]);
  if(e) return <Err msg={e}/>; if(!data) return <Loading/>;

  const surfaces=data.surfaces||[];
  const selected=surfaces.find(s=>s.surface===sel)||null;
  const t=data.totals||{};
  const a=data.assumptions||{};

  return (<div>
    <SectionHeader title="Claude Usage" hint="Prompts per user across Claude, Claude Desktop, Claude Code CLI and Claude Code on the web. Prompt counts are measured. Tokens and cost are measured for Claude Code and estimated elsewhere — the two are shown separately and never summed."/>

    <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12,padding:"7px 12px",borderRadius:6,background:"#f1f5f9",border:"1px solid #e2e8f0",fontSize:12,color:"#475569"}}>
      <Shield size={13}/>
      <span>
        Source: <strong>{data.sources_mode === "all" ? "all capture pipelines" : "Claude Usage Tracker (.exe) + Claude Code telemetry"}</strong>
        {data.sources_mode !== "all" && " — browser-extension and OS-monitor events are excluded so each prompt is counted once."}
      </span>
    </div>

    <div className="aihub_stat_grid">
      <StatCard icon={<MessageSquare size={18}/>} label="Claude prompts" value={(t.prompts||0).toLocaleString()} hint="all surfaces" color="#8b5cf6"/>
      <StatCard icon={<Activity size={18}/>} label="Measured tokens" value={fmtTokens(t.measured_tokens)} hint={`${(t.measured_requests||0).toLocaleString()} Claude Code requests`} color="#0044cc"/>
      <StatCard icon={<Wrench size={18}/>} label="Measured cost" value={fmtUsd(t.measured_cost_usd)} hint="reported by Claude Code" color="#22c55e"/>
      <StatCard icon={<Clock size={18}/>} label="Est. tokens" value={fmtTokens(t.estimated_tokens)} hint={`≈${fmtUsd(t.estimated_cost_usd)} · browser & desktop`} color="#f59e0b"/>
    </div>

    {!(t.prompts>0) && (
      <div className="aihub_card" style={{marginBottom:14}}>
        <Empty icon={<MessageSquare size={32} strokeWidth={1.5}/>} title="No Claude prompts recorded yet" msg="Run the Claude Usage Tracker (.exe) on a machine and send a prompt. Surfaces below stay listed at zero so you can see what is being tracked."/>
      </div>
    )}

    <>
      <SectionHeader title="By person / system" hint="One row per person per machine. Claude Code reports usage against a signed-in account while desktop and browser report an OS user — the tracker links them, so the same person counts once."/>
      <div className="aihub_card" style={{marginBottom:18}}>
        <DataTable columns={[
          {label:"Person",render:r=><><div className="aihub_text_primary">{r.label}</div>{r.email&&r.email!==r.label&&<div className="aihub_text_muted">{r.email}</div>}</>},
          {label:"System",render:r=>r.hostname?<Mono>{r.hostname}</Mono>:<span className="aihub_text_muted">—</span>},
          {label:"Desktop",render:r=>(r.by_surface?.["Claude Desktop"]||0),right:true},
          {label:"Browser",render:r=>(r.by_surface?.["Claude (browser)"]||0),right:true},
          {label:"Code CLI",render:r=>(r.by_surface?.["Claude Code (CLI)"]||0),right:true},
          {label:"Total prompts",render:r=><strong>{(r.prompts||0).toLocaleString()}</strong>,right:true},
          {label:"Measured cost",render:r=>r.measured_cost_usd>0?fmtUsd(r.measured_cost_usd):<span className="aihub_text_muted">—</span>,right:true},
        ]} rows={data.systems||[]} empty="No Claude usage recorded yet."/>
      </div>

      <SectionHeader title="Surfaces" hint="Claude Desktop, Claude in the browser and Claude Code CLI are always listed — a zero means tracked with no activity yet, not untracked. Select one to see per-user prompt counts."/>
      <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:14}}>
        {surfaces.map(s=>(
          <button key={s.surface} className={`aihub_filter_btn ${sel===s.surface?"active":""}`} onClick={()=>setSel(s.surface)}
                  style={s.prompts?undefined:{opacity:0.62}}>
            {s.surface} · {(s.prompts||0).toLocaleString()} prompts
            {s.measured_tokens>0 && <> · {fmtUsd(s.measured_cost_usd)}</>}
          </button>
        ))}
      </div>

      {selected && <div className="aihub_card">
        <SectionHeader
          title={`${selected.surface} — usage by user`}
          hint={
            selected.measured_tokens>0
              ? `${(selected.prompts||0).toLocaleString()} prompts · ${fmtTokens(selected.measured_tokens)} measured tokens · ${fmtUsd(selected.measured_cost_usd)} measured cost (reported by Claude Code)`
              : `${(selected.prompts||0).toLocaleString()} prompts · ${fmtTokens(selected.estimated_tokens)} estimated tokens · ≈${fmtUsd(selected.estimated_cost_usd)} estimated cost`
          }
        />
        <DataTable columns={[
          {label:"User",render:r=><><div className="aihub_text_primary">{r.label||r.user||r.hostname||"—"}</div>{!r.attributed&&<div className="aihub_text_muted">unattributed</div>}</>},
          {label:"Prompts",key:"prompts",right:true},
          {label:"Tokens",render:r=>fmtTokens(r.tokens),right:true},
          {label:"Cost",render:r=>fmtUsd(r.cost_usd),right:true},
          {label:"Basis",render:r=>r.measured
            ? <span style={{color:"#16a34a",fontWeight:600,fontSize:11}}>measured</span>
            : <span style={{color:"#b45309",fontWeight:600,fontSize:11}}>estimated</span>},
          {label:"Model",render:r=>(r.models&&r.models.length)?<Mono>{r.models[0]}</Mono>:"—"},
        ]} rows={selected.breakdown||[]} empty={`No ${selected.surface} prompts recorded yet.`}/>
      </div>}

      <p className="aihub_text_muted" style={{fontSize:11,marginTop:4}}>
        Measured rows come from Claude Code's own reporting (real token counts and cost). Estimated rows infer
        input ≈ prompt length ÷ {a.chars_per_token||4} chars/token with output assumed at {a.output_ratio||3}× input; actual billing may differ.
      </p>
    </>
  </div>);
}

const PAGES={
  Overview:{title:"AI Overview",component:OverviewView},
  ClaudeUsage:{title:"Claude Usage",component:ClaudeUsageView},
  Machines:{title:"Machines",component:MachinesView},
  Tools:{title:"Tools Catalog",component:ToolsView},
  Agents:{title:"Agents & MCP",component:AgentsView},
  ServerAgents:{title:"Server Agents",component:ServerAgentsView},
  DLP:{title:"AI Activity",component:DLPView},
  Platforms:{title:"AI Platforms",component:PlatformsView},
  AgentGovernance:{title:"Agent Governance",component:AgentGovernance},
  CopilotReadiness:{title:"Copilot Readiness",component:CopilotReadinessView},
  AIBudget:{title:"AI Budget",component:function AIBudgetPage(){return <AgentGovernanceProvider><BudgetTab/></AgentGovernanceProvider>;}},
  ModelRouting:{title:"Model Routing",component:ModelRoutingView},
  RiskScores:{title:"Risk Scores",component:RiskScoreView},
  AIRegistry:{title:"AI Registry",component:AIRegistryView},
  AccessRequests:{title:"Access Requests",component:AccessRequestsView},
  DeveloperSDK:{title:"Developer SDK",component:DeveloperSDKView},
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
