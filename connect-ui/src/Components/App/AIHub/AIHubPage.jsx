import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import SideNav from "../../Resuables/Nav/SideNav";
import TopNav from "../../Resuables/Nav/TopNav";
import AgentGovernance from "../AgentGovernance/AgentGovernance";
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
function Step({ n, title, hint, children }) {
  return (
    <div style={{ display: "flex", gap: 12, marginBottom: 20 }}>
      <div style={{ width: 32, height: 32, minWidth: 32, borderRadius: "50%", background: n <= 2 ? "#dbeafe" : n <= 3 ? "#e0e7ff" : "#dcfce7", color: n <= 2 ? "#2563eb" : n <= 3 ? "#4338ca" : "#16a34a", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 14 }}>{n}</div>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>{title}</div>
        <div className="aihub_text_muted" style={{ fontSize: 12, lineHeight: 1.5 }}>{hint}</div>
        {children && <div style={{ marginTop: 10 }}>{children}</div>}
      </div>
    </div>
  );
}
function CodeBlock({ code, label }) {
  if (!code) return <div style={{ background: "#1e293b", borderRadius: 8, padding: 16, color: "#94a3b8", fontSize: 12 }}>Loading...</div>;
  return (
    <div>
      <div style={{ background: "#1e293b", color: "#e2e8f0", borderRadius: 8, padding: 16, fontFamily: "ui-monospace, monospace", fontSize: 12, overflowX: "auto", position: "relative", lineHeight: 1.6, wordBreak: "break-all" }}>
        <code>{code}</code>
        <CopyBtn text={code} />
      </div>
      {label && <div className="aihub_text_muted" style={{ fontSize: 11, marginTop: 4 }}>{label}</div>}
    </div>
  );
}
function CopyBtn({ text }) {
  const [copied, setCopied] = useState(false);
  return (
    <svg onClick={() => {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.cssText = "position:fixed;left:-9999px";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    }}
    width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={copied ? "#22c55e" : "#94a3b8"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
    style={{ position: "absolute", top: 10, right: 10, cursor: "pointer", transition: "stroke 0.2s" }}>
    {copied
      ? <polyline points="20 6 9 17 4 12" />
      : <><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></>
    }
    </svg>
  );
}
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
// SERVER MONITOR — Install + Traces
// ═══════════════════════════════════════════════════════════════════════════════
function ServerMonitorView() {
  const [tab, setTab] = useState("traces");
  const [stats, setStats] = useState(null);
  const [servers, setServers] = useState([]);
  const [traces, setTraces] = useState([]);
  const [selectedTrace, setSelectedTrace] = useState(null);
  const [traceDetail, setTraceDetail] = useState(null);
  const [installCmd, setInstallCmd] = useState("");
  const [installMode, setInstallMode] = useState("local");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [s, srv, t] = await Promise.all([
          apiFetch("/traces/stats"),
          apiFetch("/monitor/servers"),
          apiFetch("/traces?limit=50"),
        ]);
        setStats(s);
        setServers(srv);
        setTraces(t);
      } catch (e) { console.error(e); }
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    if (tab === "setup" && !installCmd) {
      // Use the API server URL for the install command, not the dashboard URL.
      // In production the API runs on port 8787, dashboard on 3000.
      const apiOrigin = window.location.port === "3000"
        ? window.location.origin.replace(":3000", ":8787")
        : window.location.origin;
      fetch(`${API}/monitor/generate-token`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ serverUrl: apiOrigin }),
      }).then(r => r.json()).then(d => setInstallCmd(d.install_command || "")).catch(() => {});
    }
  }, [tab]);

  useEffect(() => {
    if (!selectedTrace) { setTraceDetail(null); return; }
    apiFetch("/traces/" + encodeURIComponent(selectedTrace)).then(setTraceDetail).catch(() => setTraceDetail(null));
  }, [selectedTrace]);

  if (loading) return <Loading />;

  const tabs = [
    { id: "traces", label: "Traces", icon: <Activity size={14} /> },
    { id: "servers", label: "Servers", icon: <Server size={14} /> },
    { id: "setup", label: "Setup", icon: <Plus size={14} /> },
  ];

  return (
    <div>
      {/* Stats cards */}
      <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <StatCard icon={<Activity size={18} />} label="Total Calls" value={stats?.total_calls || 0} hint="All time" color="#3b82f6" />
        <StatCard icon={<Clock size={18} />} label="Last 24h" value={stats?.calls_last_24h || 0} hint="Recent calls" color="#8b5cf6" />
        <StatCard icon={<Server size={18} />} label="Servers" value={stats?.connected_servers || 0} hint="Connected" color="#22c55e" />
        <StatCard icon={<Shield size={18} />} label="Total Cost" value={fmtUsd(stats?.total_cost_usd)} hint="All time" color="#f59e0b" />
      </div>

      {/* Tab bar */}
      <div style={{ display: "flex", gap: 2, marginBottom: 16, borderBottom: "1px solid #e5e7eb", paddingBottom: 0 }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => { setTab(t.id); setSelectedTrace(null); }}
            style={{ display: "flex", alignItems: "center", gap: 5, padding: "8px 16px", border: "none", background: "none", cursor: "pointer", fontSize: 13, fontWeight: tab === t.id ? 600 : 400, color: tab === t.id ? "#2563eb" : "#6b7280", borderBottom: tab === t.id ? "2px solid #2563eb" : "2px solid transparent", marginBottom: -1 }}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === "traces" && !selectedTrace && (
        <div>
          <SectionHeader title="Agent Execution Traces" hint="Each trace groups LLM calls from the same process into a single execution timeline" />
          <DataTable
            columns={[
              { label: "Time", render: r => <span style={{ fontSize: 12 }}>{relTime(r.started_at)}</span> },
              { label: "User", render: r => <div><div className="aihub_text_primary">{r.user || "—"}</div><div className="aihub_text_muted" style={{ fontSize: 11 }}>{(r.cmdline || "").split("/").pop()}</div></div> },
              { label: "Provider", render: r => <div>{(r.providers || []).map(p => <Tag key={p} text={p} color={p === "openai" ? "#10a37f" : p === "anthropic" ? "#d97706" : "#6366f1"} />)}</div> },
              { label: "Calls", key: "call_count", right: true },
              { label: "Duration", render: r => <span>{r.duration_ms ? (r.duration_ms / 1000).toFixed(1) + "s" : "—"}</span>, right: true },
              { label: "Tokens", render: r => fmtTokens(r.total_tokens), right: true },
              { label: "Cost", render: r => fmtUsd(r.total_cost_usd), right: true },
              { label: "Status", render: r => <Badge text={r.status} color={r.status === "error" ? "#ef4444" : "#22c55e"} /> },
              { label: "Trigger", render: r => <span className="aihub_text_muted" style={{ fontSize: 11 }}>{r.trigger_source || "—"}</span> },
            ]}
            rows={traces}
            empty="No traces yet. Install the server monitor to start capturing."
            onRow={r => setSelectedTrace(r.trace_id)}
          />
        </div>
      )}

      {tab === "traces" && selectedTrace && traceDetail && (
        <div>
          <button onClick={() => setSelectedTrace(null)} style={{ background: "none", border: "none", color: "#2563eb", cursor: "pointer", fontSize: 13, marginBottom: 12, padding: 0 }}>← Back to traces</button>
          <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 16 }}>{traceDetail.user || "Unknown"} — {(traceDetail.cmdline || "").split("/").pop()}</h3>
                <div className="aihub_text_muted" style={{ fontSize: 12, marginTop: 4 }}>
                  {traceDetail.trigger_source} · {traceDetail.cwd} · {new Date(traceDetail.started_at).toLocaleString()}
                </div>
              </div>
              <div style={{ display: "flex", gap: 12, textAlign: "right" }}>
                <div><div style={{ fontSize: 18, fontWeight: 700 }}>{traceDetail.call_count}</div><div className="aihub_text_muted" style={{ fontSize: 11 }}>calls</div></div>
                <div><div style={{ fontSize: 18, fontWeight: 700 }}>{(traceDetail.duration_ms / 1000).toFixed(1)}s</div><div className="aihub_text_muted" style={{ fontSize: 11 }}>duration</div></div>
                <div><div style={{ fontSize: 18, fontWeight: 700 }}>{fmtTokens(traceDetail.total_tokens)}</div><div className="aihub_text_muted" style={{ fontSize: 11 }}>tokens</div></div>
                <div><div style={{ fontSize: 18, fontWeight: 700 }}>{fmtUsd(traceDetail.total_cost_usd)}</div><div className="aihub_text_muted" style={{ fontSize: 11 }}>cost</div></div>
              </div>
            </div>

            {/* Timeline visualization */}
            <div style={{ borderTop: "1px solid #f3f4f6", paddingTop: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#6b7280", marginBottom: 8 }}>EXECUTION TIMELINE</div>
              {(traceDetail.calls || []).map((call, i) => {
                const totalDur = traceDetail.duration_ms || 1;
                const barLeft = ((call.offset_ms || 0) / totalDur) * 100;
                const barWidth = Math.max(((call.duration_ms || 100) / totalDur) * 100, 2);
                const isErr = call.response_status >= 400;
                const provColor = call.provider === "openai" ? "#10a37f" : call.provider === "anthropic" ? "#d97706" : "#6366f1";
                return (
                  <div key={i} style={{ marginBottom: 12, padding: 12, background: isErr ? "#fef2f2" : "#f9fafb", borderRadius: 8, border: "1px solid " + (isErr ? "#fecaca" : "#e5e7eb") }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                      <span style={{ background: provColor, color: "#fff", padding: "1px 6px", borderRadius: 4, fontSize: 10, fontWeight: 600 }}>{call.provider}</span>
                      <span style={{ fontSize: 12, fontWeight: 600 }}>{call.model}</span>
                      <span className="aihub_text_muted" style={{ fontSize: 11, marginLeft: "auto" }}>{call.duration_ms}ms · {fmtTokens((call.prompt_tokens||0)+(call.completion_tokens||0))} tokens · {fmtUsd(call.total_cost_usd)}</span>
                      {isErr && <Badge text={call.response_status} color="#ef4444" />}
                    </div>
                    {/* Bar */}
                    <div style={{ height: 6, background: "#e5e7eb", borderRadius: 3, position: "relative", marginBottom: 8 }}>
                      <div style={{ position: "absolute", left: barLeft + "%", width: barWidth + "%", height: "100%", background: isErr ? "#ef4444" : provColor, borderRadius: 3 }} />
                    </div>
                    {/* Prompt/Response preview */}
                    {call.prompt_text && <div style={{ fontSize: 11, color: "#374151", marginBottom: 4 }}><strong>Prompt:</strong> {call.prompt_text.length > 150 ? call.prompt_text.slice(0, 150) + "…" : call.prompt_text}</div>}
                    {call.response_text && <div style={{ fontSize: 11, color: "#6b7280" }}><strong>Response:</strong> {call.response_text.length > 150 ? call.response_text.slice(0, 150) + "…" : call.response_text}</div>}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {tab === "servers" && (
        <div>
          <SectionHeader title="Connected Servers" hint="Servers running the CloudFuze server monitor" />
          <DataTable
            columns={[
              { label: "Server", render: r => <div><div className="aihub_text_primary">{r.display_name || r.machine_id}</div>{r.source_ip && r.source_ip !== '127.0.0.1' && <div className="aihub_text_muted" style={{fontSize:11}}>Remote: {r.source_ip}</div>}</div> },
              { label: "Status", render: r => <Badge text={r.status} color={r.status === "active" ? "#22c55e" : "#9ca3af"} /> },
              { label: "Last Seen", render: r => relTime(r.last_seen) },
              { label: "Calls", key: "total_calls", right: true },
              { label: "Cost", render: r => fmtUsd(r.total_cost_usd), right: true },
              { label: "Users", render: r => (r.users || []).join(", ") || "—" },
              { label: "Providers", render: r => <div>{(r.providers || []).map(p => <Tag key={p} text={p} />)}</div> },
            ]}
            rows={servers}
            empty="No servers connected yet. Go to Setup tab to install."
          />
        </div>
      )}

      {tab === "setup" && (
        <div>
          <SectionHeader title="Install Server Monitor" hint="Choose your deployment mode and follow the steps" />

          {/* Mode selector */}
          <div style={{ display: "flex", gap: 12, marginBottom: 20 }}>
            {[
              { id: "local", label: "Direct Install", desc: "Monitor runs on the same server as your AI agents. Simplest setup." },
              { id: "remote", label: "Remote Monitor (Recommended)", desc: "Monitor runs on a separate machine. Nothing installed on production servers." },
            ].map(m => (
              <div key={m.id} onClick={() => setInstallMode(m.id)} style={{ flex: 1, padding: 16, border: "2px solid " + (installMode === m.id ? "#2563eb" : "#e5e7eb"), borderRadius: 10, cursor: "pointer", background: installMode === m.id ? "#eff6ff" : "#fff" }}>
                <div style={{ fontWeight: 600, fontSize: 14, color: installMode === m.id ? "#2563eb" : "#374151" }}>{m.label}</div>
                <div className="aihub_text_muted" style={{ fontSize: 12, marginTop: 4 }}>{m.desc}</div>
              </div>
            ))}
          </div>

          {/* Steps */}
          <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: 24 }}>

            {installMode === "local" ? (<>
              {/* LOCAL MODE — 2 steps */}
              <Step n={1} title="Run this command on your AI server" hint="Requires sudo. Installs the monitor, configures proxy, installs CA, and starts the service automatically.">
                <CodeBlock code={installCmd} />
              </Step>
              <Step n={2} title="Done — traces appear automatically" hint="All AI API calls (OpenAI, Anthropic, Google, AWS Bedrock) from every process on this server are now captured. No code changes needed. Come back to the Traces tab to see live data." />
            </>) : (<>
              {/* REMOTE MODE — 4 steps */}
              <Step n={1} title="Choose a monitoring machine" hint="This can be any Linux server in your network — a utility box, a jump server, or a lightweight VM. It does NOT need to be your production server." />

              <Step n={2} title="Run this command on the monitoring machine" hint="Installs the monitor with remote mode enabled. It will ask you which production server IPs are allowed to connect (for security).">
                <CodeBlock code={installCmd ? installCmd + " --remote" : ""} />
                <div style={{ background: "#fefce8", border: "1px solid #fde68a", borderRadius: 6, padding: 10, marginTop: 10, fontSize: 12, color: "#854d0e" }}>
                  The installer will prompt: <strong>"Enter allowed IP addresses"</strong> — enter the IPs of your production servers (comma-separated). Only these IPs will be able to connect. All others are blocked by firewall.
                </div>
              </Step>

              <Step n={3} title="On each production server, set one environment variable" hint="This tells the server to route AI API traffic through the monitor. Nothing is installed on the production server — just one env var.">
                <CodeBlock code="export HTTPS_PROXY=http://<monitor-machine-ip>:8443" label="Replace <monitor-machine-ip> with the actual IP of the machine from Step 2" />
                <div style={{ fontSize: 12, color: "#6b7280", marginTop: 8, lineHeight: 1.6 }}>
                  To make it permanent (survives reboot), add it to <code style={{ background: "#f1f5f9", padding: "1px 4px", borderRadius: 3 }}>/etc/environment</code>:
                </div>
                <CodeBlock code={'echo \'HTTPS_PROXY=http://<monitor-machine-ip>:8443\' | sudo tee -a /etc/environment'} />
              </Step>

              <Step n={4} title="Done — all servers appear in the dashboard" hint="Each production server shows separately in the Servers tab (identified by IP). The monitor machine itself is also tracked. Come back to the Traces tab to see live execution data from all connected servers." />
            </>)}

            {/* What gets captured */}
            <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 8, padding: 14, marginTop: 20 }}>
              <div style={{ fontWeight: 600, fontSize: 13, color: "#166534", marginBottom: 6 }}>What gets captured from every server:</div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: "#166534", lineHeight: 1.8 }}>
                <li>Every LLM API call — provider, model, tokens, cost, full prompt and response</li>
                <li>Who made the call — user, process name, command line, working directory</li>
                <li>How it was triggered — SSH session, cron job, CI pipeline, systemd service</li>
                <li>Timing — start time, duration, latency, HTTP status, errors</li>
                <li>Source server — IP address of the server that made the call</li>
              </ul>
            </div>

            {/* Management commands */}
            <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: 14, marginTop: 12 }}>
              <div style={{ fontWeight: 600, fontSize: 13, color: "#334155", marginBottom: 8 }}>Management commands (run on the monitor machine):</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, fontSize: 12 }}>
                <code style={{ color: "#2563eb" }}>cloudfuze-monitor status</code><span className="aihub_text_muted">Check if the service is running</span>
                <code style={{ color: "#2563eb" }}>cloudfuze-monitor logs</code><span className="aihub_text_muted">View live logs (Ctrl+C to stop)</span>
                <code style={{ color: "#2563eb" }}>cloudfuze-monitor restart</code><span className="aihub_text_muted">Restart the monitor service</span>
                <code style={{ color: "#2563eb" }}>cloudfuze-monitor uninstall</code><span className="aihub_text_muted">Remove everything cleanly</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

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
  ServerMonitor:{title:"Server Monitor",component:ServerMonitorView},
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
