import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import SideNav from "../../Resuables/Nav/SideNav";
import TopNav from "../../Resuables/Nav/TopNav";
import AgentGovernance from "../AgentGovernance/AgentGovernance";
import {
  Monitor, Scan, AlertTriangle, Wrench, Server, Shield, Clock, ChevronRight,
  Search, RefreshCw, Activity, FileText, MessageSquare, Eye, Trash2, Plus, X,
  History, ArrowLeft, Bot, User, ShieldAlert, Film, PlayCircle, MonitorPlay,
  Maximize2, Minimize2,
} from "lucide-react";
import { sanitizeReplayEvents } from "./replaySanitize";
import { createReplayHost, applyReplayIframeCsp } from "./rrwebHost";
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

// Lazily fetches /dlp/:id/content for ONE event and classifies it by
// Content-Type. Content is only ever pulled when a reviewer explicitly asks for
// it (drawer opened / transcript message expanded) — never eagerly for a list.
// Shared by ContentDrawer (side panel) and InlineContent (session transcript).
function useCapturedContent(eventId) {
  const [state,setState]=useState({status:"loading"});
  const [url,setUrl]=useState(null);
  useEffect(()=>{
    let cancelled=false, revoke=null;
    (async()=>{
      setState({status:"loading"});
      setUrl(null);
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
  return { state, url };
}

// Side drawer that fetches /dlp/:id/content and renders by Content-Type:
// text → highlighted block, image → <img>, pdf → <iframe>, else download link.
function ContentDrawer({ eventId, meta, onClose }) {
  const { state, url }=useCapturedContent(eventId);
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
// 8. SESSION REPLAY
// ═══════════════════════════════════════════════════════════════════════════════

// Which side of the conversation a message belongs to. The server stamps `role`
// on every event it stores (derived server-side from the event kind, never taken
// from the client). The fallback mirrors the server's own kind→role map so rows
// written before `role` existed still land on the correct side.
const USER_KINDS=new Set(["prompt_submit","prompt_paste","prompt_typed","file_upload"]);
const ASSISTANT_KINDS=new Set(["ai_response"]);
function msgRole(m) {
  if(m.role==="user"||m.role==="assistant"||m.role==="system") return m.role;
  if(USER_KINDS.has(m.event_kind)) return "user";
  if(ASSISTANT_KINDS.has(m.event_kind)) return "assistant";
  return "system";
}

// Enforcement / decision events are governance bookkeeping, not conversation
// content, so they render as a compact inline note instead of a chat bubble.
const SYSTEM_KINDS={
  blocked:{label:"Blocked",color:"#ef4444"},
  prompt_blocked:{label:"Prompt blocked",color:"#ef4444"},
  policy_block:{label:"Blocked by policy",color:"#ef4444"},
  file_blocked:{label:"File upload blocked",color:"#ef4444"},
  redacted:{label:"Redacted before send",color:"#f59e0b"},
  tokenized:{label:"Tokenized & sent",color:"#0891b2"},
  warned:{label:"User warned",color:"#f59e0b"},
  user_decision:{label:"User decision",color:"#8b5cf6"},
  allowed:{label:"Allowed",color:"#22c55e"},
};
function systemNote(m) {
  const known=SYSTEM_KINDS[m.event_kind];
  return {
    label:known?.label||String(m.event_kind||"system event").replace(/_/g," "),
    color:known?.color||"#6b7280",
  };
}

// Field resolvers. The session/message payloads are still settling on the server
// side, so read the top-level column first and fall back to metadata — that way
// the transcript keeps rendering whichever shape the API actually returns.
function msgMatches(m) { const x=m.matches??m.metadata?.matches; return Array.isArray(x)?x:[]; }
function msgSeverity(m) { return m.secret_class||m.highest_severity||m.metadata?.highest_severity||m.severity||null; }
function sessionSeverity(s) { return s.highest_severity||s.severity||s.secret_class||null; }
function hasContent(m) { return m.has_content===true||m.has_content===1; }
function fmtTime(d) { if(!d) return "—"; const t=new Date(d); return Number.isNaN(t.getTime())?"—":t.toLocaleString(); }
// The API returns messages already ordered by client_seq; sort defensively anyway
// and fall back to the wall clock when the extension didn't stamp a sequence.
function seqCmp(a,b) {
  if(a.client_seq!=null&&b.client_seq!=null&&a.client_seq!==b.client_seq) return a.client_seq-b.client_seq;
  const at=new Date(a.occurred_at||a.received_at||0).getTime()||0;
  const bt=new Date(b.occurred_at||b.received_at||0).getTime()||0;
  if(at!==bt) return at-bt;
  return (a.client_seq??0)-(b.client_seq??0);
}
function machineLabel(machines,id) {
  const m=machines?.[id];
  if(m) return m.hostname||m.user||String(id||"").slice(0,16);
  return String(id||"—").slice(0,28);
}
function ApiMissing({ msg, what }) {
  // A 404 on the list/summary routes means the API isn't deployed on this server
  // yet — say so instead of rendering an empty dashboard that reads as "no AI
  // activity", which is the wrong conclusion for a governance view to invite.
  if(msg==="404") return <Err msg={`${what} is not available on this server yet (API returned 404).`}/>;
  return <Err msg={msg}/>;
}

// Captured content rendered INLINE in the transcript (same lazy fetch the DLP
// drawer uses) — a chat replay reads better in place than in a side panel.
function InlineContent({ eventId, meta }) {
  const { state, url }=useCapturedContent(eventId);
  const filename=meta?.metadata?.filename;
  if(state.status==="loading") return <div className="aihub_loading" style={{padding:12}}><RefreshCw size={14} className="aihub_spin"/> Loading content…</div>;
  if(state.status==="error") return <div style={{padding:12}}><div className="aihub_error"><AlertTriangle size={14}/> {state.error}</div></div>;
  return (<>
    {state.truncated && <div style={{padding:"8px 12px 0"}}><Badge text="truncated" color="#f59e0b"/></div>}
    {state.kind==="text" && <TextContent text={state.text} contentType={state.contentType}/>}
    {state.kind==="image" && <div style={{padding:12,display:"flex",justifyContent:"center"}}><img src={url} alt={filename||"captured image"} style={{maxWidth:"100%",borderRadius:6}}/></div>}
    {state.kind==="pdf" && <iframe src={url} title={filename||"PDF preview"} style={{width:"100%",height:420,border:0,borderRadius:6}}/>}
    {state.kind==="binary" && (
      <div style={{padding:16,textAlign:"center"}}>
        <FileText size={22} strokeWidth={1.5}/>
        <div style={{marginTop:6,fontWeight:600,color:"#374151",fontSize:13}}>{filename||"Binary file"}</div>
        <div className="aihub_text_muted" style={{marginTop:2,fontSize:11}}>{state.contentType||"application/octet-stream"} · cannot render inline</div>
        <a href={url} download={filename||"download.bin"} className="aihub_dl_btn">Download file</a>
      </div>
    )}
  </>);
}

// ── DOM-event session replay ────────────────────────────────────────────────
// A "replay run" is an rrweb capture of the page: an ordered stream of DOM
// mutations and interaction events, NOT video. Playback means feeding those
// events to rrweb's Replayer, which reconstructs the live DOM inside an iframe.
// Recording is automatic and can pause/resume, so a session can hold several
// runs — everything below is written against a LIST.

const REPLAY_STATUS_TONE={recording:"#0891b2",complete:"#22c55e",aborted:"#ef4444",expired:"#9ca3af"};
// Height the rrweb-player controller bar needs under the stage.
const REPLAY_CONTROLS_H=88;

// ── AUTH SEAM ───────────────────────────────────────────────────────────────
// /api/v1/replays/* sits behind requireAdminAuth, which has no dev bypass — it
// 401s in every environment. The dashboard's own apiFetch (used for /sessions
// and /dlp, which the server deliberately leaves open) sends no credential, so
// admin routes need this wrapper.
//
// The previous video player shipped a HARDCODED dev admin bearer token here.
// Its justification was mechanical: `<video src>` cannot carry an Authorization
// header, so the token had to be reachable from frontend code to fetch media at
// all. That constraint is gone — replay data is JSON fetched with fetch(), which
// carries headers like any other request — so the workaround is gone with it.
//
// What replaces it:
//   * credentials:"same-origin" — the correct long-term answer is a session
//     cookie on the admin routes, and that is already wired up here, so the day
//     the server sets one this function needs no change.
//   * an OPTIONAL VITE_ADMIN_TOKEN, read from the environment and never given a
//     default. A developer puts it in connect-ui/.env.local; with nothing set,
//     no Authorization header is sent and the player renders its explicit
//     "needs an admin credential" panel. There is therefore no credential
//     embedded in this repository, and none in a build unless the person doing
//     the build supplies one.
async function adminFetch(path, init) {
  const token=import.meta.env.VITE_ADMIN_TOKEN;
  return fetch(`${API}${path}`, {
    ...init,
    credentials:"same-origin",
    headers:{
      ...(token?{ Authorization:`Bearer ${token}` }:null),
      ...(init?.headers||{}),
    },
  });
}

function classifyRecErr(status) {
  if(status===401||status===403) return "unauthorized";
  if(status===410) return "expired";
  if(status===404) return "missing";
  return null;
}

// Timestamps may arrive as epoch ms (rrweb's own clock) or as an ISO string
// (Mongo dates). Both mean the same instant; normalise to ms.
function toEpochMs(v) {
  if(v==null||v==="") return null;
  if(typeof v==="number") return Number.isFinite(v)?v:null;
  const n=Number(v);
  if(Number.isFinite(n)&&String(v).trim()!==""&&!/[^0-9.]/.test(String(v).trim())) return n;
  const t=Date.parse(String(v));
  return Number.isFinite(t)?t:null;
}
function firstEpochMs(...vals) {
  for(const v of vals){ const n=toEpochMs(v); if(n!=null) return n; }
  return null;
}
function intOrNull(v) { const n=Number(v); return Number.isFinite(n)?n:null; }

// Field names on the manifest are read defensively: the server track is being
// built in parallel, and a rename there should degrade one metadata cell rather
// than break playback or transcript sync.
function normalizeManifest(m) {
  const chunks=(Array.isArray(m?.chunks)?m.chunks:[])
    .map(c=>({
      seq:Number(c?.seq),
      eventCount:intOrNull(c?.event_count),
      firstTs:toEpochMs(c?.first_ts),
      lastTs:toEpochMs(c?.last_ts),
      hasFullSnapshot:!!(c?.has_full_snapshot),
      byteSize:Number(c?.byte_size)||0,
      sha256:c?.sha256??null,
    }))
    .filter(c=>Number.isFinite(c.seq))
    .sort((a,b)=>a.seq-b.seq);
  const last=chunks.length?chunks[chunks.length-1]:null;
  return {
    raw:m||{},
    chunks,
    // The anchor for transcript sync. rrweb stamps every event with an absolute
    // epoch ms from the same client clock that produces a message's
    // occurred_at, so one subtraction gives a turn's offset into the replay —
    // no segment arithmetic, unlike the video player this replaced.
    firstEventTs:firstEpochMs(m?.first_event_ts,m?.first_ts,m?.first_event_at,chunks[0]?.firstTs,m?.started_at),
    lastEventTs:firstEpochMs(m?.last_event_ts,m?.last_ts,m?.last_event_at,last?.lastTs,m?.ended_at),
    durationMs:intOrNull(m?.duration_ms),
    eventCount:intOrNull(m?.event_count),
    chunkCount:intOrNull(m?.chunk_count)??chunks.length,
    status:String(m?.status||"").toLowerCase(),
    expiresAt:m?.expires_at??null,
    byteSize:Number(m?.byte_size)||chunks.reduce((s,c)=>s+c.byteSize,0),
    integrity:(m&&typeof m.integrity==="object"&&m.integrity)||null,
  };
}

// The server's integrity block reports what the endpoint said it sent next to
// what is actually stored. Rather than hardcode key names that are still in
// flux, pair every `<thing>_stored` with a `<thing>_client_reported` /
// `_client_expected` sibling and report the ones that disagree.
function integrityGaps(man) {
  const gaps=[];
  const integrity=man?.integrity;
  if(integrity){
    for(const key of Object.keys(integrity)){
      const m=/^(.+)_stored$/.exec(key);
      if(!m) continue;
      const stored=Number(integrity[key]);
      if(!Number.isFinite(stored)) continue;
      for(const suffix of ["_client_reported","_client_expected"]){
        const other=`${m[1]}${suffix}`;
        if(!(other in integrity)) continue;
        const reported=Number(integrity[other]);
        if(!Number.isFinite(reported)||reported===stored) continue;
        gaps.push({ label:m[1].replace(/_/g," "), stored, reported });
      }
    }
  }
  // Independent of the server's own accounting: the run's headline event count
  // versus the sum over its chunk index.
  const summed=man?.chunks?.reduce((s,c)=>s+(c.eventCount||0),0);
  if(man?.eventCount!=null&&man.chunks.length&&summed!=null&&summed!==man.eventCount){
    gaps.push({ label:"events", stored:summed, reported:man.eventCount });
  }
  return gaps;
}

// GET /replays/:id — run metadata + the chunk index (no events).
function useReplayManifest(replayId) {
  const [state,setState]=useState({status:"idle"});
  useEffect(()=>{
    if(!replayId){ setState({status:"idle"}); return undefined; }
    let cancelled=false;
    setState({status:"loading"});
    (async()=>{
      try{
        const res=await adminFetch(`/replays/${encodeURIComponent(replayId)}`);
        if(cancelled) return;
        const known=classifyRecErr(res.status);
        if(known){ setState({status:known}); return; }
        if(!res.ok){ setState({status:"error",error:`HTTP ${res.status}`}); return; }
        const body=await res.json();
        if(cancelled) return;
        setState({status:"ok",manifest:normalizeManifest(body)});
      }catch(err){ if(!cancelled) setState({status:"error",error:err?.message||String(err)}); }
    })();
    return ()=>{ cancelled=true; };
  },[replayId]);
  return state;
}

// NDJSON → rrweb events. One bad line must not take the whole replay down, so
// unparseable lines are counted and reported; the reviewer is told the stream
// was incomplete instead of being shown a replay that quietly skipped events.
function parseNdjsonEvents(text) {
  const events=[];
  let badLines=0;
  for(const line of String(text||"").split(/\r?\n/)){
    const trimmed=line.trim();
    if(!trimmed) continue;
    try{
      const ev=JSON.parse(trimmed);
      if(ev&&typeof ev==="object"&&Number.isFinite(Number(ev.timestamp))&&Number.isFinite(Number(ev.type))) events.push(ev);
      else badLines++;
    }catch{ badLines++; }
  }
  // The route promises order, but rrweb applies events blindly and a single
  // out-of-order mutation corrupts the reconstruction. Array.prototype.sort is
  // stable, so events sharing a timestamp keep their transmitted order.
  events.sort((a,b)=>Number(a.timestamp)-Number(b.timestamp));
  return { events, badLines };
}

// GET /replays/:id/events — the whole ordered stream, then sanitised so the
// reconstruction cannot reach the network. See replaySanitize.js for why.
function useReplayEvents(replayId) {
  const [state,setState]=useState({status:"idle"});
  useEffect(()=>{
    if(!replayId){ setState({status:"idle"}); return undefined; }
    let cancelled=false;
    setState({status:"loading"});
    (async()=>{
      try{
        const res=await adminFetch(`/replays/${encodeURIComponent(replayId)}/events`);
        if(cancelled) return;
        const known=classifyRecErr(res.status);
        if(known){ setState({status:known}); return; }
        if(!res.ok){ setState({status:"error",error:`HTTP ${res.status}`}); return; }
        const text=await res.text();
        if(cancelled) return;
        const { events, badLines }=parseNdjsonEvents(text);
        if(!events.length){
          setState({status:badLines?"parse_error":"empty",badLines});
          return;
        }
        const safe=sanitizeReplayEvents(events);
        setState({
          status:"ok",
          events:safe.events,
          badLines,
          blocked:safe.blocked,
          dropped:safe.dropped,
          firstTs:Number(events[0].timestamp),
          lastTs:Number(events[events.length-1].timestamp),
        });
      }catch(err){ if(!cancelled) setState({status:"error",error:err?.message||String(err)}); }
    })();
    return ()=>{ cancelled=true; };
  },[replayId]);
  return state;
}

function fmtDurationMs(ms) {
  // Guard null/"" explicitly: Number(null) is 0, which would render an
  // in-progress clip (duration_ms still null) as a zero-length "0:00".
  if(ms==null||ms==="") return "—";
  const n=Number(ms);
  if(!Number.isFinite(n)||n<0) return "—";
  const total=Math.round(n/1000);
  const h=Math.floor(total/3600), m=Math.floor((total%3600)/60), s=total%60;
  const pad=v=>String(v).padStart(2,"0");
  return h>0?`${h}:${pad(m)}:${pad(s)}`:`${m}:${pad(s)}`;
}
function fmtBytes(bytes) {
  const b=Number(bytes);
  if(!Number.isFinite(b)||b<=0) return "—";
  const units=["B","KB","MB","GB","TB"];
  let v=b,i=0;
  while(v>=1024&&i<units.length-1){ v/=1024; i++; }
  return `${i===0||v>=10?Math.round(v):v.toFixed(1)} ${units[i]}`;
}
// Whole days until retention deletes the media. null when the API didn't say.
function expiresInDays(expiresAt) {
  const t=Date.parse(expiresAt||"");
  if(!Number.isFinite(t)) return null;
  return Math.ceil((t-Date.now())/86400000);
}
// null  → the API said nothing about replays (server track not deployed):
//         render nothing, the transcript-only view is unchanged.
// []    → replays are supported but this session has none.
function normalizeReplays(list) {
  if(!Array.isArray(list)) return null;
  return list
    .filter(r=>r&&r.replay_id&&Number.isFinite(Date.parse(r.started_at)))
    .sort((a,b)=>Date.parse(a.started_at)-Date.parse(b.started_at));
}

// Seek button shown on any transcript turn that falls inside the active run.
// Labelled with its offset into the replay so a reviewer can see the mapping.
function JumpBtn({ offsetMs, onClick }) {
  return (
    <button className="aihub_jump_btn" onClick={e=>{e.stopPropagation();onClick();}}
      title={`Seek the recording to ${fmtDurationMs(offsetMs)}`}>
      <PlayCircle size={12}/> {fmtDurationMs(offsetMs)}
    </button>
  );
}

// The player. Playback is a DOM RECONSTRUCTION, not a media element: the event
// stream is handed to rrweb-player, which drives rrweb's Replayer and supplies
// the play/pause/scrubber controls.
//
// Two things make this different from the video player it replaced:
//
//  1. ISOLATION. The recorded DOM still references external assets by URL
//     (inlineImages:false), so a naive replay makes the REVIEWER's browser fetch
//     from chatgpt.com/claude.ai live — telling the vendor that this company is
//     auditing AI use right now, and painting today's assets into a weeks-old
//     recording. Two independent controls prevent it: every external reference is
//     stripped from the events (replaySanitize.js), and the whole player is
//     mounted inside a CSP-locked iframe (rrwebHost.js). Both are always on.
//
//  2. rrweb-player is loaded with a dynamic import so its ~1MB of replay engine
//     and Svelte runtime is fetched only when a reviewer actually opens a session
//     that has a replay (see the rrweb chunk in vite.config.js).
//
// `apiRef` is filled with { seek(offsetMs) } and `tickRef.current` is called with
// the playhead position — both by design avoid re-rendering the transcript.
// The manifest is fetched by the PARENT and passed in as `man`, because the
// transcript needs its first_event_ts to place turns on the replay timeline.
function ReplayPlayer({ replays, activeIdx, onSelect, man, apiRef, tickRef, onReady }) {
  const run=replays[activeIdx]||replays[0];
  const replayId=run?.replay_id;

  const manifest=man.status==="ok"?man.manifest:null;
  const chunkCount=manifest?(manifest.chunkCount??manifest.chunks.length):0;
  // Don't pull a potentially large event stream for a run the server has no
  // chunks for, or for a run whose manifest never loaded.
  const ev=useReplayEvents(manifest&&chunkCount>0?replayId:null);
  const events=ev.status==="ok"?ev.events:null;
  const playable=!!events&&events.length>=2;

  const stageRef=useRef(null);
  // idle → mounting → ready | error. `hardened` records whether the CSP iframe
  // was actually established; false is surfaced to the reviewer, never hidden.
  const [engine,setEngine]=useState({status:"idle"});

  useEffect(()=>{
    if(!playable) { setEngine({status:"idle"}); return undefined; }
    const container=stageRef.current;
    if(!container) return undefined;

    let cancelled=false, host=null, player=null, observer=null, raf=0;
    setEngine({status:"mounting"});

    (async()=>{
      try{
        const [mod,cssMod]=await Promise.all([
          import("rrweb-player"),
          // The player's stylesheet has to be injected as TEXT because its DOM
          // lives in a child document; ?inline gives the CSS source instead of a
          // <link> in this document. Losing it costs styling, not function.
          import("rrweb-player/dist/style.css?inline").catch(()=>({default:""})),
        ]);
        if(cancelled) return;
        const RrwebPlayer=mod.default||mod.Player;
        if(typeof RrwebPlayer!=="function") throw new Error("rrweb-player did not export a constructor");

        host=await createReplayHost(container,cssMod?.default||"");
        if(cancelled||!host){ host?.destroy(); return; }

        const sizeFor=()=>{
          const w=Math.max(320,Math.floor(container.clientWidth)||640);
          return { width:w, height:Math.round(w*0.62) };
        };
        const initial=sizeFor();
        host.setHeight(initial.height+REPLAY_CONTROLS_H);

        player=new RrwebPlayer({
          target:host.mount,
          props:{
            events,
            width:initial.width,
            height:initial.height,
            autoPlay:false,
            showController:true,
            speedOption:[1,2,4,8],
          },
        });
        if(cancelled) throw new Error("unmounted during mount");

        // Defence in depth for the fallback path; a no-op when the CSP wrapper
        // is in place. rrweb wipes the replay document on every full snapshot,
        // so re-apply after each rebuild rather than once.
        const replayer=player.getReplayer?.();
        applyReplayIframeCsp(replayer?.iframe);
        try{ replayer?.on?.("fullsnapshot-rebuilded",()=>applyReplayIframeCsp(replayer.iframe)); }catch{ /* older engine */ }

        // Playhead → transcript. Routed through a ref so a ~10Hz tick never
        // re-renders this component or the transcript list.
        player.addEventListener?.("ui-update-current-time",p=>{
          const ms=Number(p?.payload);
          if(Number.isFinite(ms)) tickRef.current?.(ms);
        });
        if(apiRef) apiRef.current={
          seek:offsetMs=>{
            // No second argument: rrweb-player keeps playing if it was playing.
            try{ player.goto(Math.max(0,Math.round(offsetMs))); }catch{ /* torn down */ }
          },
        };

        if(typeof ResizeObserver==="function"){
          observer=new ResizeObserver(()=>{
            cancelAnimationFrame(raf);
            raf=requestAnimationFrame(()=>{
              const next=sizeFor();
              try{
                player.$set({ width:next.width, height:next.height });
                player.triggerResize?.();
                host.setHeight(next.height+REPLAY_CONTROLS_H);
              }catch{ /* destroyed mid-resize */ }
            });
          });
          observer.observe(container);
        }

        setEngine({status:"ready",hardened:host.hardened});
        onReady?.(true);
      }catch(err){
        if(!cancelled) setEngine({status:"error",error:err?.message||String(err)});
      }
    })();

    return ()=>{
      cancelled=true;
      cancelAnimationFrame(raf);
      observer?.disconnect();
      if(apiRef) apiRef.current=null;
      try{ player?.$destroy?.(); }catch{ /* already gone */ }
      host?.destroy?.();
      onReady?.(false);
    };
  },[playable,events,apiRef,tickRef,onReady]);

  if(!run) return null;

  const runStatus=String(run.status||"").toLowerCase();
  // expires_at rides on the admin manifest, not on the open sessions route.
  const days=expiresInDays(manifest?.expiresAt||run.expires_at);
  const purged=runStatus==="expired"||man.status==="expired"||ev.status==="expired";
  const gaps=manifest?integrityGaps(manifest):[];
  const eventCount=manifest?.eventCount??run.event_count??(events?events.length:null);

  return (
    <div className="aihub_card aihub_rec_card">
      <SectionHeader
        title="Session replay"
        hint={replays.length>1
          ? `${replays.length} recorded runs in this session — recording pauses and resumes with the tab.`
          : "Reconstructed page activity for this conversation."}
      />
      {replays.length>1 && (
        <div className="aihub_rec_tabs" role="tablist" aria-label="Replay runs in this session">
          {replays.map((r,i)=>(
            <button key={r.replay_id} type="button" role="tab" aria-selected={i===activeIdx}
              className={`aihub_filter_btn ${i===activeIdx?"active":""}`}
              onClick={()=>onSelect(i)}
              title={`Started ${fmtTime(r.started_at)} · ${fmtDurationMs(r.duration_ms)}`}>
              Run {i+1} · {fmtDurationMs(r.duration_ms)}
            </button>
          ))}
        </div>
      )}

      {/* Every failure mode gets a named state — a governance view must never
          render an inert empty box and leave the reviewer guessing. */}
      {purged ? (
        <div className="aihub_rec_gone">
          <MonitorPlay size={26} strokeWidth={1.5}/>
          <div className="aihub_rec_gone_title">Replay no longer stored</div>
          <p className="aihub_text_muted">This run passed its retention window, so the recorded events were purged. The transcript below is retained.</p>
        </div>
      ) : (man.status==="unauthorized"||ev.status==="unauthorized") ? (
        <div className="aihub_rec_gone">
          <Shield size={26} strokeWidth={1.5}/>
          <div className="aihub_rec_gone_title">Replay needs an admin credential</div>
          <p className="aihub_text_muted">
            The replay routes require admin auth and this dashboard sent none the server accepted. For local review, put <Mono>VITE_ADMIN_TOKEN</Mono> in <Mono>connect-ui/.env.local</Mono> matching the server&apos;s <Mono>ADMIN_TOKEN</Mono> and restart the dev server. The metadata below comes from the open sessions route and is accurate.
          </p>
        </div>
      ) : (man.status==="missing"||ev.status==="missing") ? (
        <div className="aihub_rec_gone">
          <MonitorPlay size={26} strokeWidth={1.5}/>
          <div className="aihub_rec_gone_title">Replay not found</div>
          <p className="aihub_text_muted">The session references this run but the server has no manifest for it.</p>
        </div>
      ) : (man.status==="loading"||man.status==="idle") ? (
        <div className="aihub_rec_gone">
          <RefreshCw size={22} className="aihub_spin"/>
          <div className="aihub_rec_gone_title">Loading replay manifest…</div>
        </div>
      ) : man.status==="error" ? (
        <Err msg={`Could not load the replay manifest: ${man.error}`}/>
      ) : chunkCount===0 ? (
        <div className="aihub_rec_gone">
          <MonitorPlay size={26} strokeWidth={1.5}/>
          <div className="aihub_rec_gone_title">No events stored yet</div>
          <p className="aihub_text_muted">The run is registered but no event chunks have been uploaded from the endpoint.</p>
        </div>
      ) : (ev.status==="loading"||ev.status==="idle") ? (
        <div className="aihub_rec_gone">
          <RefreshCw size={22} className="aihub_spin"/>
          <div className="aihub_rec_gone_title">Loading {eventCount!=null?`${eventCount.toLocaleString()} `:""}events…</div>
          <p className="aihub_text_muted">{chunkCount} chunk{chunkCount===1?"":"s"} · {fmtBytes(manifest?.byteSize)}</p>
        </div>
      ) : ev.status==="parse_error" ? (
        <Err msg={`The event stream could not be read: ${ev.badLines} line${ev.badLines===1?"":"s"} of NDJSON failed to parse and none were valid.`}/>
      ) : ev.status==="empty" ? (
        <div className="aihub_rec_gone">
          <MonitorPlay size={26} strokeWidth={1.5}/>
          <div className="aihub_rec_gone_title">Event stream is empty</div>
          <p className="aihub_text_muted">The chunk index lists {chunkCount} chunk{chunkCount===1?"":"s"} but the events route returned nothing usable.</p>
        </div>
      ) : ev.status==="error" ? (
        <Err msg={`Could not load the event stream: ${ev.error}`}/>
      ) : !playable ? (
        <div className="aihub_rec_gone">
          <MonitorPlay size={26} strokeWidth={1.5}/>
          <div className="aihub_rec_gone_title">Not enough events to replay</div>
          <p className="aihub_text_muted">Only {events?.length??0} event{events?.length===1?"":"s"} were stored — a replay needs at least a viewport snapshot and one DOM snapshot.</p>
        </div>
      ) : (<>
        {/* rrweb-player is mounted into this node by the effect above, inside a
            CSP-locked iframe. Never render replay markup directly in here. */}
        <div ref={stageRef} className="aihub_replay_stage"/>
        {engine.status==="mounting" && <div className="aihub_rec_hint"><RefreshCw size={12} className="aihub_spin"/> Starting the replay engine…</div>}
        {engine.status==="error" && <div style={{marginTop:10}}><Err msg={`The replay engine failed to start: ${engine.error}`}/></div>}
        {engine.status==="ready" && (engine.hardened
          ? <div className="aihub_rec_hint"><Shield size={12}/> Sandboxed: the replay runs under a CSP that blocks every outbound request, so nothing is fetched from the AI vendor while you review.</div>
          : <div className="aihub_rec_hint aihub_rec_warn"><AlertTriangle size={12}/> The isolated replay container could not be created, so playback is running in this page. External references were still stripped from the recording, but treat this as degraded — check the browser console.</div>
        )}
      </>)}

      <div className="aihub_rec_meta">
        <div>
          <div className="aihub_replay_meta_label">Status</div>
          <div><Badge text={runStatus||manifest?.status||"unknown"} color={REPLAY_STATUS_TONE[runStatus]||"#6b7280"}/></div>
        </div>
        <div>
          <div className="aihub_replay_meta_label">Duration</div>
          <div className="aihub_text_primary">{fmtDurationMs(manifest?.durationMs??run.duration_ms)}</div>
        </div>
        <div>
          <div className="aihub_replay_meta_label">Events</div>
          <div className="aihub_text_primary">{eventCount!=null?eventCount.toLocaleString():"—"}</div>
        </div>
        <div>
          <div className="aihub_replay_meta_label">Chunks</div>
          <div className="aihub_text_primary">{manifest?chunkCount:(run.chunk_count??"—")}</div>
        </div>
        <div>
          <div className="aihub_replay_meta_label">Started</div>
          <div className="aihub_text_primary">{fmtTime(run.started_at)}</div>
        </div>
        <div>
          <div className="aihub_replay_meta_label">Retention</div>
          <div>
            {days==null
              ? <span className="aihub_text_muted">—</span>
              : days>0
                ? <span className="aihub_text_primary">expires in {days} day{days===1?"":"s"}</span>
                : <Badge text="expired" color="#9ca3af"/>}
          </div>
        </div>
      </div>

      {runStatus==="recording" && (
        <div className="aihub_rec_hint"><Clock size={12}/> Still recording — the replay won&apos;t include the most recent moments yet.</div>
      )}
      {runStatus==="aborted" && (
        <div className="aihub_rec_hint"><AlertTriangle size={12}/> Capture ended unexpectedly, so this run may stop short of the conversation.</div>
      )}
      {/* Integrity: what the endpoint said it sent vs what the server holds. A
          replay with holes still plays, so say so rather than let a reviewer
          read a gap as "nothing happened". */}
      {gaps.map((g,i)=>(
        <div key={i} className="aihub_rec_hint aihub_rec_warn">
          <AlertTriangle size={12}/> This recording may have gaps: {g.stored.toLocaleString()} {g.label} stored, {g.reported.toLocaleString()} reported by the endpoint.
        </div>
      ))}
      {ev.status==="ok" && ev.badLines>0 && (
        <div className="aihub_rec_hint aihub_rec_warn">
          <AlertTriangle size={12}/> {ev.badLines.toLocaleString()} line{ev.badLines===1?"":"s"} of the event stream could not be parsed and were skipped — the replay is incomplete.
        </div>
      )}
      {ev.status==="ok" && (ev.blocked>0||ev.dropped>0) && (
        <div className="aihub_rec_hint">
          <Shield size={12}/> {ev.blocked.toLocaleString()} external asset reference{ev.blocked===1?"":"s"} neutralised
          {ev.dropped>0?`, ${ev.dropped.toLocaleString()} web-font event${ev.dropped===1?"":"s"} dropped`:""} — images and fonts the recorder did not inline show as blanks, by design.
        </div>
      )}

      <div className="aihub_replay_ids">
        <span className="aihub_text_muted">Replay</span> <Mono>{run.replay_id}</Mono>
        {run.capture && <> <span className="aihub_text_muted">· Capture</span> <Mono>{run.capture}</Mono></>}
      </div>
    </div>
  );
}

// One message in the replay. User prompts and AI replies are chat bubbles;
// enforcement/decision events are a one-line system note.
// `userLabel` comes from the SESSION, not the message — GET /sessions/:id does
// not repeat machine_id on every turn (they all belong to one machine anyway).
// `syncOffsetMs` is this turn's offset into the ACTIVE recording, or null when
// no clip covers it (including every session that predates recording). When
// null the turn renders and behaves exactly as it did before this feature.
// `registerRef` hands the outer node to the parent so playback sync can toggle
// a highlight class directly on the DOM instead of re-rendering the list.
function TranscriptMessage({ msg, userLabel, expanded, onToggle, syncOffsetMs, onSeek, registerRef }) {
  const role=msgRole(msg);
  const msgId=msg.id;
  const attach=useCallback(node=>{ registerRef?.(msgId,node); },[registerRef,msgId]);

  const seekable=syncOffsetMs!=null&&typeof onSeek==="function";
  const jump=useCallback(()=>{ onSeek?.(syncOffsetMs); },[onSeek,syncOffsetMs]);
  // Clicking the turn seeks the video, but never hijack a click that was really
  // aimed at a control inside the bubble, or a click that ends a text selection.
  const onClick=useCallback(e=>{
    if(!seekable) return;
    if(e.target.closest("button,a,input,select,textarea,video,iframe,img,pre,mark")) return;
    if(window.getSelection?.()?.toString()) return;
    jump();
  },[seekable,jump]);

  if(role==="system") {
    const note=systemNote(msg);
    return (
      <div ref={attach} className={`aihub_sys_note${seekable?" aihub_seekable":""}`}
        style={{borderColor:note.color+"40",background:note.color+"0d"}}
        onClick={seekable?onClick:undefined}
        title={seekable?"Click to seek the recording to this moment":undefined}>
        <ShieldAlert size={13} style={{color:note.color,flexShrink:0}}/>
        <span style={{color:note.color,fontWeight:600}}>{note.label}</span>
        {msg.pattern_matched && <span className="aihub_text_muted">· {msg.pattern_matched}</span>}
        {seekable && <JumpBtn offsetMs={syncOffsetMs} onClick={jump}/>}
        <span className="aihub_msg_time" style={{marginLeft:"auto"}}>{fmtTime(msg.occurred_at)}</span>
      </div>
    );
  }
  const matches=msgMatches(msg);
  const sev=msgSeverity(msg);
  const who=role==="user"?(userLabel||"User"):"AI response";
  return (
    <div ref={attach} className={`aihub_msg_row ${role}`}>
      <div className={`aihub_msg_bubble ${role}${seekable?" aihub_seekable":""}`}
        onClick={seekable?onClick:undefined}
        title={seekable?"Click to seek the recording to this moment":undefined}>
        <div className="aihub_msg_head">
          {role==="user"?<User size={12}/>:<Bot size={12}/>}
          <span className="aihub_msg_who">{who}</span>
          <Tag text={msg.event_kind||"unknown"}/>
          {sev && <SeverityBadge sev={sev}/>}
          <span className="aihub_msg_time">{fmtTime(msg.occurred_at)}</span>
        </div>
        {matches.length>0 && (
          <div className="aihub_msg_chips">
            {matches.map((x,j)=><Badge key={j} text={`${x.pattern}${x.count>1?` ×${x.count}`:""}`} color="#ef4444"/>)}
          </div>
        )}
        <div className="aihub_msg_foot">
          {seekable && <JumpBtn offsetMs={syncOffsetMs} onClick={jump}/>}
          {msg.metadata?.filename && <Mono>{msg.metadata.filename}</Mono>}
          {msg.content_length>0 && <span className="aihub_text_muted">{msg.content_length.toLocaleString()} chars</span>}
          {hasContent(msg)
            ? <button className="aihub_view_btn" onClick={onToggle} aria-expanded={expanded}><Eye size={13}/> {expanded?"Hide content":"View content"}</button>
            : <span className="aihub_text_muted">content not captured</span>}
        </div>
        {expanded && <div className="aihub_msg_content"><InlineContent eventId={msg.id} meta={msg}/></div>}
      </div>
    </div>
  );
}

// Detail view: session metadata + the full chronological transcript.
function SessionTranscriptView({ session, machines, onBack }) {
  const [data,setData]=useState(null),[err,setErr]=useState(null),[openId,setOpenId]=useState(null);
  // Which replay run is loaded, and whether its player has actually mounted.
  // `playerReady` is state (not a ref) because the transcript only offers a seek
  // affordance once there is something to seek.
  const [activeRun,setActiveRun]=useState(0);
  const [playerReady,setPlayerReady]=useState(false);
  // The replay column defaults to a fixed max-width so the transcript stays
  // readable beside it. Maximizing widens the replay to the full row and
  // hides the transcript column, rather than opening a separate overlay —
  // the player already re-sizes itself via ResizeObserver (see ReplayPlayer),
  // so a plain CSS-driven width change is all this needs.
  const [maximized,setMaximized]=useState(false);
  const sid=session.session_id;
  useEffect(()=>{
    let cancelled=false;
    setData(null); setErr(null); setOpenId(null); setActiveRun(0);
    apiFetch(`/sessions/${encodeURIComponent(sid)}`)
      .then(d=>{ if(!cancelled) setData(d); })
      .catch(x=>{ if(!cancelled) setErr(x.message); });
    return ()=>{ cancelled=true; };
  },[sid]);

  // Header renders from the list row immediately, so "back" always works even
  // if the detail fetch fails.
  const meta={...session,...(data?.session||{})};
  const messages=useMemo(()=>[...(data?.messages||[])].sort(seqCmp),[data]);
  const sev=sessionSeverity(meta);
  const userLabel=machineLabel(machines,meta.machine_id);

  // null → this server doesn't report replays yet, [] → none for this session.
  // The wire field is `replays` (GET /api/v1/sessions/:session_id) — reading the
  // wrong key made normalizeReplays always see undefined, i.e. permanently null,
  // so the player never mounted even when the session had runs.
  const replays=useMemo(()=>normalizeReplays(data?.replays),[data]);
  const hasPlayer=Array.isArray(replays)&&replays.length>0;
  const activeReplay=hasPlayer?(replays[activeRun]||replays[0]):null;
  // Owned here rather than in the player: the transcript needs the run's
  // first_event_ts to place turns on the replay timeline.
  const man=useReplayManifest(activeReplay?.replay_id||null);

  // Absolute epoch window the active run covers. rrweb stamps every event with
  // an epoch ms from the same client clock that stamps a message's occurred_at,
  // so a turn's replay offset is one subtraction — the segment-boundary
  // arithmetic the video player needed is simply gone.
  const timeBase=man.status==="ok"?man.manifest.firstEventTs:null;
  const timeEnd=man.status==="ok"
    ? (man.manifest.lastEventTs
        ?? (timeBase!=null&&man.manifest.durationMs!=null?timeBase+man.manifest.durationMs:null))
    : null;

  // Offsets of each turn into the ACTIVE run, ascending, so the playhead handler
  // only has to binary-search.
  const timeline=useMemo(()=>{
    if(timeBase==null) return [];
    const end=timeEnd!=null?timeEnd:Number.POSITIVE_INFINITY;
    const out=[];
    for(const m of messages){
      if(m.id==null) continue;
      const t=Date.parse(m.occurred_at||"");
      if(!Number.isFinite(t)||t<timeBase||t>end) continue;
      out.push({ id:m.id, offsetMs:t-timeBase });
    }
    out.sort((a,b)=>a.offsetMs-b.offsetMs);
    return out;
  },[timeBase,timeEnd,messages]);
  const offsetById=useMemo(()=>new Map(timeline.map(t=>[t.id,t.offsetMs])),[timeline]);

  // id → outer DOM node of each rendered turn, for ref-based highlighting.
  const msgNodes=useRef(new Map());
  const registerMsgNode=useCallback((id,node)=>{
    if(node) msgNodes.current.set(id,node);
    else msgNodes.current.delete(id);
  },[]);
  const syncedId=useRef(null);
  // Filled by ReplayPlayer with { seek(offsetMs) }.
  const playerApi=useRef(null);
  // ReplayPlayer calls tickRef.current(playheadMs) on every player tick.
  const tickRef=useRef(null);
  const lastTick=useRef(0);
  const onPlayerReady=useCallback(ready=>setPlayerReady(!!ready),[]);

  const seekTo=useCallback(offsetMs=>{
    if(offsetMs==null) return;
    // Let the very next tick through the throttle so the highlight follows the
    // click immediately instead of up to 200ms later.
    lastTick.current=0;
    playerApi.current?.seek(Math.max(0,offsetMs));
  },[]);

  // Playback → transcript highlight. The player ticks ~10x/s, so this never
  // touches React state: it toggles a class on the two affected nodes only, and
  // bails early when the active turn hasn't changed.
  useEffect(()=>{
    const clearActive=()=>{
      if(syncedId.current!=null){
        msgNodes.current.get(syncedId.current)?.classList.remove("aihub_msg_synced");
        syncedId.current=null;
      }
    };
    if(!playerReady||!timeline.length){ tickRef.current=null; clearActive(); return undefined; }

    // Last turn at or before the playhead.
    const apply=playheadMs=>{
      let lo=0,hi=timeline.length-1,found=-1;
      while(lo<=hi){
        const mid=(lo+hi)>>1;
        if(timeline[mid].offsetMs<=playheadMs){ found=mid; lo=mid+1; } else hi=mid-1;
      }
      const id=found>=0?timeline[found].id:null;
      if(id===syncedId.current) return;
      if(syncedId.current!=null) msgNodes.current.get(syncedId.current)?.classList.remove("aihub_msg_synced");
      syncedId.current=id;
      if(id==null) return;
      const node=msgNodes.current.get(id);
      if(!node) return;
      node.classList.add("aihub_msg_synced");
      const reduce=window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
      node.scrollIntoView({ block:"nearest", behavior:reduce?"auto":"smooth" });
    };
    tickRef.current=ms=>{
      const now=Date.now();
      if(now-lastTick.current<200) return;
      lastTick.current=now;
      apply(ms);
    };
    return ()=>{ tickRef.current=null; clearActive(); };
  },[playerReady,timeline]);

  const transcriptCard=(
    <div className="aihub_card">
      {/* The detail route exists, so a 404 here means this specific session is
          gone — not that the API is missing. */}
      {err && <Err msg={err==="404"?"This session no longer exists on the server.":err}/>}
      {!err && !data && <Loading/>}
      {!err && data && messages.length===0 && (
        <Empty icon={<MessageSquare size={32} strokeWidth={1.5}/>} title="No messages in this session" msg="This session was created by a bind event but no prompts or replies were captured for it."/>
      )}
      {!err && messages.length>0 && (<>
        {data?.messages_truncated && (
          <div style={{marginBottom:12}}><Badge text={`Showing the first ${messages.length.toLocaleString()} turns — this session is longer`} color="#f59e0b"/></div>
        )}
        {hasPlayer && (
          <p className="aihub_text_muted" style={{fontSize:11,margin:"0 0 12px"}}>
            Turns inside the selected run show a timecode — click a turn to seek the replay there. The turn matching playback is highlighted as the replay plays.
          </p>
        )}
        <div className="aihub_transcript">
          {messages.map((m,i)=>(
            <TranscriptMessage
              key={m.id||`${m.client_seq}-${i}`}
              msg={m}
              userLabel={userLabel}
              expanded={openId===m.id}
              onToggle={()=>setOpenId(openId===m.id?null:m.id)}
              syncOffsetMs={m.id!=null&&offsetById.has(m.id)?offsetById.get(m.id):null}
              // Only offer seeking once the player has actually mounted — a run
              // whose events were purged by retention has nothing to drive.
              onSeek={playerReady?seekTo:undefined}
              registerRef={registerMsgNode}
            />
          ))}
        </div>
      </>)}
    </div>
  );

  return (<div>
    <SectionHeader
      title="Session Replay"
      hint="Chronological transcript of one AI conversation."
      action={<button className="aihub_back_btn" onClick={onBack} aria-label="Back to session list"><ArrowLeft size={14}/> Back to sessions</button>}
    />
    <div className="aihub_card">
      <div className="aihub_replay_meta">
        <div><div className="aihub_replay_meta_label">AI service</div><div><Badge text={meta.ai_service||"unknown"} color="#0044cc"/></div></div>
        <div><div className="aihub_replay_meta_label">Machine / user</div><div className="aihub_text_primary">{userLabel}</div></div>
        <div><div className="aihub_replay_meta_label">Started</div><div className="aihub_text_primary">{fmtTime(meta.started_at)}</div></div>
        <div><div className="aihub_replay_meta_label">Last activity</div><div className="aihub_text_primary">{fmtTime(meta.last_activity_at)}</div></div>
        <div><div className="aihub_replay_meta_label">Messages</div><div className="aihub_text_primary">{meta.message_count??messages.length}</div></div>
        <div><div className="aihub_replay_meta_label">Highest severity</div><div>{sev?<SeverityBadge sev={sev}/>:<span className="aihub_text_muted">—</span>}</div></div>
      </div>
      <div className="aihub_replay_ids">
        <span className="aihub_text_muted">Session</span> <Mono>{sid}</Mono>
        {meta.external_conv_id && <> <span className="aihub_text_muted">· Conversation</span> <Mono>{meta.external_conv_id}</Mono></>}
      </div>
    </div>

    {/* With a replay: player pinned on the left, transcript scrolls beside it.
        Without one: the transcript renders exactly as it did before this
        feature, full width and untouched. */}
    {hasPlayer ? (
      <div className={`aihub_replay_split${maximized?" aihub_replay_split_max":""}`}>
        <div className="aihub_replay_video_col">
          <button type="button" className="aihub_replay_maximize_btn"
            onClick={()=>setMaximized(m=>!m)}
            title={maximized?"Restore transcript view":"Maximize the replay"}>
            {maximized?<Minimize2 size={13}/>:<Maximize2 size={13}/>} {maximized?"Restore":"Maximize"}
          </button>
          <ReplayPlayer
            replays={replays}
            activeIdx={activeRun}
            onSelect={setActiveRun}
            man={man}
            apiRef={playerApi}
            tickRef={tickRef}
            onReady={onPlayerReady}
          />
        </div>
        <div className="aihub_replay_transcript_col">{transcriptCard}</div>
      </div>
    ) : (<>
      {/* replays === [] means the server supports replays and this session
          simply has none. `null` (older server, or a session captured before
          this feature) says nothing at all. */}
      {Array.isArray(replays)&&replays.length===0 && (
        <div className="aihub_rec_none"><MonitorPlay size={13}/> No replay available for this session.</div>
      )}
      {transcriptCard}
    </>)}
  </div>);
}

// List view: stats, filters, and one row per conversation.
function SessionListView({ onOpen, machines }) {
  const [rows,setRows]=useState(null),[summary,setSummary]=useState(null),[err,setErr]=useState(null);
  const [service,setService]=useState("all"),[sev,setSev]=useState("all"),[range,setRange]=useState("all"),[q,setQ]=useState("");
  useEffect(()=>{
    let cancelled=false;
    Promise.all([
      apiFetch("/sessions?limit=500"),
      apiFetch("/sessions/stats/summary").catch(()=>null),
    ]).then(([s,sum])=>{
      if(cancelled) return;
      setRows(Array.isArray(s)?s:(s?.sessions??[]));
      setSummary(sum);
    }).catch(x=>{ if(!cancelled) setErr(x.message); });
    return ()=>{ cancelled=true; };
  },[]);

  if(err) return <div><SectionHeader title="Session Replay" hint="Replay a captured AI conversation end to end."/><div className="aihub_card"><ApiMissing msg={err} what="Session Replay"/></div></div>;
  if(!rows) return <Loading/>;

  // The summary route names the alert counter `sessions_with_high_severity`;
  // accept the shorter alias too, then fall back to counting the loaded page.
  const totalSessions=summary?.total_sessions??rows.length;
  const totalMessages=summary?.total_messages??rows.reduce((s,r)=>s+(r.message_count||0),0);
  const hiCrit=summary?.sessions_with_high_severity??summary?.high_severity_sessions??rows.filter(r=>isHiCrit(sessionSeverity(r))).length;
  const distinctMachines=summary?.distinct_machines??new Set(rows.map(r=>r.machine_id).filter(Boolean)).size;

  const services=[...new Set(rows.map(r=>r.ai_service).filter(Boolean))].sort();
  const ranges=[["all","All time"],["24h","Last 24h"],["7d","Last 7 days"],["30d","Last 30 days"]];
  const windowMs={"24h":86400000,"7d":604800000,"30d":2592000000}[range]||null;
  const severities=["all","critical","high","medium","low"];
  // GET /sessions returns the ai_sessions doc, which currently carries no
  // per-session severity rollup — so don't offer a filter that would silently
  // empty the table. Lights up automatically if the API starts sending one.
  const sevAvailable=rows.some(r=>sessionSeverity(r));

  const filtered=rows.filter(r=>{
    if(service!=="all"&&r.ai_service!==service) return false;
    if(sevAvailable&&sev!=="all"&&String(sessionSeverity(r)||"").toLowerCase()!==sev) return false;
    if(windowMs){
      const t=new Date(r.last_activity_at||r.started_at||0).getTime();
      if(!t||Date.now()-t>windowMs) return false;
    }
    if(q&&![machineLabel(machines,r.machine_id),r.machine_id,r.ai_service].join(" ").toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  }).sort((a,b)=>new Date(b.last_activity_at||b.started_at||0)-new Date(a.last_activity_at||a.started_at||0));

  return (<div>
    <SectionHeader
      title="Session Replay"
      hint="Every captured AI conversation, grouped into sessions. Click a session to replay it in order."
      action={<div className="aihub_search_box"><Search size={14}/><input placeholder="Search machine or service..." value={q} onChange={e=>setQ(e.target.value)}/></div>}
    />
    <div className="aihub_stat_grid">
      <StatCard icon={<History size={18}/>} label="Sessions" value={totalSessions} color="#0044cc"/>
      <StatCard icon={<MessageSquare size={18}/>} label="Messages captured" value={totalMessages} color="#8b5cf6"/>
      <StatCard icon={<AlertTriangle size={18}/>} label="High / critical sessions" value={hiCrit} hint="needs review" color="#ef4444"/>
      <StatCard icon={<Monitor size={18}/>} label="Distinct machines" value={distinctMachines} color="#f59e0b"/>
    </div>

    <div className="aihub_filter_bar">
      <label className="aihub_filter_group">
        <span className="aihub_filter_label">AI service</span>
        <select className="aihub_select" value={service} onChange={e=>setService(e.target.value)}>
          <option value="all">All services</option>
          {services.map(s=><option key={s} value={s}>{s}</option>)}
        </select>
      </label>
      <label className="aihub_filter_group">
        <span className="aihub_filter_label">Date range</span>
        <select className="aihub_select" value={range} onChange={e=>setRange(e.target.value)}>
          {ranges.map(([v,l])=><option key={v} value={v}>{l}</option>)}
        </select>
      </label>
      <div className="aihub_filter_group">
        <span className="aihub_filter_label">Severity</span>
        <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}>
          {severities.map(s=>(
            <button key={s} className={`aihub_filter_btn ${sev===s?"active":""}`} disabled={!sevAvailable}
              style={!sevAvailable?{opacity:0.5,cursor:"not-allowed"}:undefined}
              onClick={()=>setSev(s)}>{s}</button>
          ))}
          {!sevAvailable && <span className="aihub_text_muted" style={{fontSize:11}}>per-session severity not reported yet</span>}
        </div>
      </div>
    </div>

    <div className="aihub_card">
      <SectionHeader title="Sessions" hint={`${filtered.length} of ${rows.length} sessions`}/>
      <DataTable onRow={r=>onOpen(r)} columns={[
        {label:"When",render:r=>relTime(r.last_activity_at||r.started_at)},
        {label:"Machine / user",render:r=><><div className="aihub_text_primary">{machineLabel(machines,r.machine_id)}</div><div className="aihub_text_muted">{r.machine_id}</div></>},
        {label:"AI service",render:r=><Badge text={r.ai_service||"unknown"} color="#0044cc"/>},
        {label:"Messages",render:r=>r.message_count??0,right:true},
        {label:"Highest severity",render:r=>{const s=sessionSeverity(r);return s?<SeverityBadge sev={s}/>:<span className="aihub_text_muted">—</span>;}},
        {label:"",render:()=><span className="aihub_view_btn"><Eye size={13}/> Replay</span>,right:true},
      ]} rows={filtered} empty={rows.length?"No sessions match these filters.":"No AI sessions captured yet."}/>
    </div>
  </div>);
}

function SessionReplayView() {
  const [active,setActive]=useState(null);      // session row being replayed
  const [machines,setMachines]=useState({});
  // Sessions only carry machine_id; /machines turns that into hostname + user.
  // Non-fatal: the transcript falls back to the raw id if this fails.
  useEffect(()=>{
    let cancelled=false;
    apiFetch("/machines").then(list=>{
      if(cancelled) return;
      const map={}; (list||[]).forEach(m=>{ map[m.id]={hostname:m.hostname,user:m.user}; });
      setMachines(map);
    }).catch(()=>{});
    return ()=>{ cancelled=true; };
  },[]);
  return active
    ? <SessionTranscriptView session={active} machines={machines} onBack={()=>setActive(null)}/>
    : <SessionListView onOpen={setActive} machines={machines}/>;
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
  SessionReplay:{title:"Session Replay",component:SessionReplayView},
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
