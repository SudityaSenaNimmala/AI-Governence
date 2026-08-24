import { useState, useEffect, useRef, useMemo, useCallback, Fragment } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import SideNav from "../../Resuables/Nav/SideNav";
import TopNav from "../../Resuables/Nav/TopNav";
import AgentGovernance from "../AgentGovernance/AgentGovernance";
import { AgentGovernanceProvider, useAgentAuth } from "../AgentGovernance/AgentGovernanceContext";
import { agentGovernanceApi } from "../AgentGovernance/AgentGovernanceActions/AgentGovernanceActions";
import { PoliciesTab } from "../AgentGovernance/tabs/PoliciesTab";
import {
  Monitor, Scan, AlertTriangle, Wrench, Server, Shield, Clock, ChevronRight,
  Search, RefreshCw, Activity, FileText, MessageSquare, Eye, Trash2, Plus, X,
  History, ArrowLeft, Bot, User, ShieldAlert, Film, PlayCircle, MonitorPlay,
  Maximize2, Minimize2, Copy, Check, DollarSign, ExternalLink, Download, Boxes,
  ChevronDown,
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
// Test/low-volume traces routinely cost a fraction of a cent — toFixed(2) alone
// rounds every one of those down to "$0.00", which reads as "no cost" even
// though a real, non-zero cost was recorded. Below a cent, show enough
// decimals to see the real number instead of silently rounding it to zero.
function fmtUsd(n) {
  const v = n || 0;
  if (v > 0 && v < 0.01) return "$" + v.toFixed(6).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
  return "$" + v.toFixed(2);
}
function fmtTokens(n) { if (!n) return "—"; if (n>1e6) return (n/1e6).toFixed(1)+"M"; if (n>1e3) return (n/1e3).toFixed(1)+"K"; return n; }

// ── Client-side pricing (USD per 1M tokens) ──────────────────────────────
// Cost is calculated here, not in the monitor, so pricing updates are instant
// and all traces (old + new) always show correct costs.
const PRICING = [
  // Anthropic
  { m: /^claude-opus-4/,         input: 15.00, output: 75.00, cached: 1.50 },
  { m: /^claude-sonnet-4/,       input: 3.00,  output: 15.00, cached: 0.30 },
  { m: /^claude-haiku-4/,        input: 1.00,  output: 5.00,  cached: 0.10 },
  { m: /^claude-3-5-sonnet/,     input: 3.00,  output: 15.00, cached: 0.30 },
  { m: /^claude-3-5-haiku/,      input: 0.80,  output: 4.00,  cached: 0.08 },
  { m: /^claude-3-opus/,         input: 15.00, output: 75.00, cached: 1.50 },
  // OpenAI
  { m: /^gpt-4\.1-nano/,         input: 0.10,  output: 0.40,  cached: 0.025 },
  { m: /^gpt-4\.1-mini/,         input: 0.40,  output: 1.60,  cached: 0.10 },
  { m: /^gpt-4\.1/,              input: 2.00,  output: 8.00,  cached: 0.50 },
  { m: /^gpt-4o-mini/,           input: 0.15,  output: 0.60,  cached: 0.075 },
  { m: /^gpt-4o/,                input: 2.50,  output: 10.00, cached: 1.25 },
  { m: /^gpt-4-turbo/,           input: 10.00, output: 30.00, cached: 10.00 },
  { m: /^gpt-4(?![\.\do]|-turbo)/, input: 30.00, output: 60.00, cached: 30.00 },
  { m: /^gpt-3\.5-turbo/,        input: 0.50,  output: 1.50,  cached: 0.50 },
  { m: /^o3-mini/,               input: 1.10,  output: 4.40,  cached: 0.55 },
  { m: /^o3/,                    input: 10.00, output: 40.00, cached: 2.50 },
  { m: /^o1-mini/,               input: 3.00,  output: 12.00, cached: 1.50 },
  { m: /^o1/,                    input: 15.00, output: 60.00, cached: 7.50 },
  // Google
  { m: /^gemini-2\.5-pro/,       input: 1.25,  output: 10.00, cached: 0.31 },
  { m: /^gemini-2\.5-flash/,     input: 0.30,  output: 2.50,  cached: 0.075 },
  { m: /^gemini-1\.5-pro/,       input: 1.25,  output: 5.00,  cached: 0.31 },
  { m: /^gemini-1\.5-flash/,     input: 0.075, output: 0.30,  cached: 0.019 },
];
function calcCost(model, promptTokens = 0, completionTokens = 0, cachedTokens = 0) {
  if (!model) return 0;
  const p = PRICING.find(r => r.m.test(model));
  if (!p) return 0;
  const billed = Math.max(0, promptTokens - cachedTokens);
  return (billed * p.input + cachedTokens * p.cached + completionTokens * p.output) / 1_000_000;
}
// Convenience: calculate cost from a trace/call object
function traceCost(r) {
  return calcCost(r.model, r.prompt_tokens || 0, r.completion_tokens || 0, r.cached_tokens || 0);
}

// Only surface the severities that matter to a reviewer.
const HI_CRIT = new Set(["critical", "high"]);
function isHiCrit(sev) { return HI_CRIT.has(String(sev||"").toLowerCase()); }
const SEV_RANK = { critical: 4, high: 3, medium: 2, low: 1 };
function sevOf(e) { return e?.secret_class || e?.highest_severity || e?.severity || null; }
function worstSev(events) {
  let best = null;
  for (const e of events) {
    const s = sevOf(e);
    if (s && (!best || (SEV_RANK[s] || 0) > (SEV_RANK[best] || 0))) best = s;
  }
  return best;
}

// ── Enforcement grouping ─────────────────────────────────────────────────────
// One user action can emit several DLP events, and listing them flat makes the
// table look like it repeats itself: a typed prompt and the block that stopped
// it are two rows a few hundred ms apart, and a browser block plus the choice
// the person made at the modal are two more. This folds each such set into ONE
// row that states the OUTCOME, with the members still reachable by expanding —
// nothing is hidden, and nothing is deleted from the audit trail.
//
// TWO JOINS, DELIBERATELY DIFFERENT IN CONFIDENCE:
//
//   EXACT — the browser extension stamps a correlation id on the block and
//   echoes it as `decision_for` on whatever the user then chose
//   (enforcement_decision / enforcement_redact). That is a real key, so the
//   pairing is certain.
//
//   INFERRED — the OS monitor has no such id: its keystroke enforcer and its
//   prompt capture are separate subsystems that never learn each other's event
//   ids. So a prompt pairs with a block only on same machine + same service +
//   within PAIR_WINDOW_MS + non-conflicting pattern, greedily nearest-first,
//   each event used at most once. Measured against production data this pairs 43
//   of 85 blocks; the remaining 42 have no prompt event to pair with and keep
//   their own rows.
//
// ANYTHING NOT CONFIDENTLY PAIRED IS LEFT ALONE. On a DLP screen an invented
// pairing — "this prompt was blocked" about a prompt that wasn't — is worse than
// two honest rows. The real fix for the inferred half is a correlation id from
// the agent's enforcer, which would make this join exact too.
const PAIR_WINDOW_MS = 2000;
// Block → the user's answer at the modal. Wide because it measures a HUMAN
// deciding, not two subsystems reporting the same instant: observed 1.2s–25.9s
// in production. Bounded by causal order and pattern agreement instead of time.
const OUTCOME_WINDOW_MS = 30000;

// Equal patterns, or one side recorded none. The OS monitor's prompt capture
// sometimes stores an empty pattern list for an event its enforcer did flag
// (seen 0–1ms apart in production data), so an empty side must not veto a pair
// the timestamps make obvious.
function patternsCompatible(a, b) {
  const x = String(a||"").trim(), y = String(b||"").trim();
  return !x || !y || x === y;
}

function groupMembers(row) { return [row, ...(row._children || [])]; }
// The member whose captured text the View button should open. The prompt itself
// is preferred over an enforcement event that merely echoed it.
function contentMember(row) {
  const ms = groupMembers(row).filter(e => e.has_content);
  return ms.find(e => String(e.event_kind).startsWith("prompt_")) || ms[0] || null;
}
function groupPattern(row) {
  const pats = new Set();
  for (const e of groupMembers(row)) {
    for (const p of String(e.pattern_matched||"").split(",")) if (p.trim()) pats.add(p.trim());
  }
  return [...pats].join(", ") || "—";
}

/** Fold paired events into single rows. Returns primaries with `_children`. */
function groupDlpEvents(rows) {
  const evs = [...(rows||[])].sort((a,b)=>new Date(b.occurred_at)-new Date(a.occurred_at));
  const claimed = new Set();            // folded into another row
  const children = new Map();           // primary id -> members
  const exact = new Set();              // primaries joined on a real key
  const addChild = (primary, child) => {
    if (!children.has(primary.id)) children.set(primary.id, []);
    children.get(primary.id).push(child);
    claimed.add(child.id);
  };

  // EXACT — decision_for points at the block carrying that correlation id.
  const blockByCorr = new Map();
  for (const e of evs) {
    const c = e.metadata?.correlation_id;
    if (c && e.event_kind === "enforcement_block") blockByCorr.set(c, e);
  }
  for (const e of evs) {
    const ref = e.metadata?.decision_for;
    if (!ref) continue;
    const block = blockByCorr.get(ref);
    if (block && block.id !== e.id && !claimed.has(block.id)) { addChild(block, e); exact.add(block.id); }
  }

  // INFERRED, browser extension — an outcome whose block carries no correlation
  // id, which is every event ingested before the server started persisting it.
  // Pairs to the most recent PRECEDING block on the same machine and service
  // with a compatible pattern. Safer than it looks: causal order is guaranteed
  // (the modal cannot be answered before it opens), the pattern must agree, and
  // each block is consumed once. The window is wide because the gap is a person
  // deciding at a modal — measured at 1.2s to 25.9s across production data.
  const OUTCOME_KINDS = new Set(["enforcement_decision","enforcement_redact","enforcement_override"]);
  const extBlocks = evs.filter(e=>e.source==="browser_extension" && e.event_kind==="enforcement_block");
  for (const o of evs) {
    if (o.source !== "browser_extension" || !OUTCOME_KINDS.has(o.event_kind) || claimed.has(o.id)) continue;
    let best = null;
    for (const b of extBlocks) {
      if (claimed.has(b.id) || children.has(b.id)) continue;
      if (b.machine_id !== o.machine_id || b.ai_service !== o.ai_service) continue;
      if (!patternsCompatible(o.pattern_matched, b.pattern_matched)) continue;
      const dt = new Date(o.occurred_at) - new Date(b.occurred_at);
      if (dt < 0 || dt > OUTCOME_WINDOW_MS) continue;
      if (!best || dt < best.dt) best = { dt, b };
    }
    if (best) addChild(best.b, o);
  }

  // INFERRED — OS monitor prompt ↔ block, nearest pair first.
  const osBlocks  = evs.filter(e=>e.source==="os_monitor" && e.event_kind==="enforcement_block" && !claimed.has(e.id));
  const osPrompts = evs.filter(e=>e.source==="os_monitor" && String(e.event_kind).startsWith("prompt_") && !claimed.has(e.id));
  const candidates = [];
  for (const b of osBlocks) for (const p of osPrompts) {
    if (p.machine_id !== b.machine_id || p.ai_service !== b.ai_service) continue;
    if (!patternsCompatible(p.pattern_matched, b.pattern_matched)) continue;
    const dt = Math.abs(new Date(p.occurred_at) - new Date(b.occurred_at));
    if (dt > PAIR_WINDOW_MS) continue;
    candidates.push({ dt, b, p });
  }
  candidates.sort((x,y)=>x.dt-y.dt);
  const promptTaken = new Set();
  for (const { b, p } of candidates) {
    if (claimed.has(b.id) || promptTaken.has(p.id)) continue;
    // The PROMPT leads: it carries the captured text (so View still works) and
    // the higher severity. The block it triggered becomes its outcome.
    addChild(p, b);
    promptTaken.add(p.id);
  }

  return evs.filter(e=>!claimed.has(e.id))
    .map(e=>({ ...e, _children: children.get(e.id) || [], _exact: exact.has(e.id) }));
}
// Prefer the resolved AI platform (e.g. "Gemini in Gmail" / Google) over the raw
// request host (e.g. "mail.google.com"), which is what the OS monitor records.
function ServiceCell({ row }) {
  const name = row.platform?.product || row.ai_service || "—";
  const vendor = row.platform?.vendor;
  return (<><div className="aihub_text_primary">{name}</div>{vendor && <div className="aihub_text_muted">{vendor}</div>}</>);
}

// WHO did it. Every activity row carries `user` (the OS username for the desktop
// agent, the signed-in email for the browser extension) and `hostname`, resolved
// server-side by attachMachineIdentity — a row's own stamp wins over the machine
// lookup, so a shared device still names the right person. Access-request rows
// carry an admin-curated `employee_name` on top of that and it wins.
// Neither name nor host is guaranteed on a machine that was never enrolled, so
// the machine id is the last resort: the row stays traceable instead of showing
// a bare dash the admin can do nothing with.
function UserCell({ row }) {
  const name = row?.employee_name || row?.user || null;
  const host = row?.hostname || null;
  if (name) return (<><div className="aihub_text_primary">{name}</div>{host && host !== name && <div className="aihub_text_muted">{host}</div>}</>);
  if (host) return <div className="aihub_text_primary">{host}</div>;
  const mid = row?.machine_id;
  return mid ? <Mono>{String(mid).slice(0,10)}</Mono> : <span className="aihub_text_muted">—</span>;
}

// When a row stands for more than one event, the control that reveals the rest.
// Lives in the When cell: the Kind column it used to sit in is gone, and the
// members it opens are all near-simultaneous, so time is where a reader looks.
function GroupToggle({ row, open, onToggle }) {
  const n = (row._children||[]).length;
  if (!n) return null;
  return (
    <button onClick={e=>{e.stopPropagation();onToggle();}}
      style={{display:"inline-flex",alignItems:"center",gap:2,marginTop:3,padding:0,border:"none",background:"none",
        color:"#0044cc",fontSize:10,fontWeight:600,cursor:"pointer"}}>
      {n+1} events {open ? <ChevronDown size={11}/> : <ChevronRight size={11}/>}
    </button>
  );
}
// The folded-away members, in the order they happened, so the sequence that
// produced the outcome is legible: prompt → block → what the person chose.
function GroupDetail({ row, onView }) {
  const ms = [...groupMembers(row)].sort((a,b)=>new Date(a.occurred_at)-new Date(b.occurred_at));
  return (<div style={{padding:"10px 14px"}}>
    <div className="aihub_text_muted" style={{fontSize:11,fontWeight:600,marginBottom:6}}>
      {row._exact ? "Events correlated by id" : "Events grouped by time, machine and pattern"}
    </div>
    <table className="aihub_table" style={{fontSize:11}}><tbody>
      {ms.map(e=>(<tr key={e.id}>
        <td style={{whiteSpace:"nowrap"}}>{new Date(e.occurred_at).toLocaleTimeString()}</td>
        <td><Tag text={e.event_kind}/></td>
        <td>{e.metadata?.decision || e.metadata?.mechanism || e.metadata?.blocked_for
          ? <span className="aihub_text_muted">{String(e.metadata.decision||e.metadata.mechanism||e.metadata.blocked_for).replace(/_/g," ")}</span>
          : <span className="aihub_text_muted">—</span>}
          {/* WHICH file an attachment block was about. The cell above says what
              was stopped ("file upload") but never which document, and a block
              on an attachment is always about one specific file — desktop
              attachment holds included. Appended rather than given its own
              column so the folded-row layout above is untouched, and only
              rendered when a filename exists, so prompt-only blocks look
              exactly as they did. */}
          {e.metadata?.filename && <> <Mono>{e.metadata.filename}</Mono></>}</td>
        <td><Mono>{e.pattern_matched||"—"}</Mono></td>
        <td><SeverityBadge sev={sevOf(e)}/></td>
        <td style={{textAlign:"right"}}><ViewBtn has={e.has_content} onClick={()=>onView(e)}/></td>
      </tr>))}
    </tbody></table>
  </div>);
}

// ── Shared UI ────────────────────────────────────────────────────────────────
function StatCard({ icon, label, value, hint, color="#0052e0", onClick }) {
  const loading = value === "…" || value === "..." || value == null;
  return (<div className={`aihub_stat_card${onClick?" aihub_stat_card_clickable":""}`} onClick={onClick} style={onClick?{cursor:"pointer"}:undefined}>
    <div className="aihub_stat_icon" style={{background:color+"14",color}}>{icon}</div>
    <div style={{flex:1,minWidth:0}}>
      <div className="aihub_stat_value">{loading?<span className="aihub_shimmer_block" style={{width:52,height:24,borderRadius:6}}/>:(typeof value==="number"?value.toLocaleString():value)}</div>
      <div className="aihub_stat_label">{label}</div>
      {hint&&<div className="aihub_stat_sub">{hint}</div>}
    </div>
    {onClick&&<div style={{marginLeft:"auto",color:"#b0b6c0",display:"flex",alignItems:"center",transition:"transform 0.2s"}}><ChevronRight size={16}/></div>}
  </div>);
}
function SectionHeader({ title, hint, action }) {
  return (<div className="aihub_section_header"><div><h3 className="aihub_section_title">{title}</h3>{hint&&<p className="aihub_section_subtitle">{hint}</p>}</div>{action}</div>);
}
function Badge({ text, color="#6b7280" }) {
  return <span className="aihub_badge" style={{background:color+"12",color,borderColor:color+"25"}}>{text}</span>;
}
function RiskBadge({ score }) { if(score==null) return <span className="aihub_text_muted">—</span>; const c=score>=70?"#ef4444":score>=40?"#f59e0b":"#22c55e"; return <Badge text={score} color={c}/>; }
function SanctionBadge({ status }) { const c={approved:"#22c55e",restricted:"#f59e0b",blocked:"#ef4444",unknown:"#9ca3af"}; return <Badge text={status||"unknown"} color={c[status]||c.unknown}/>; }
function SeverityBadge({ sev }) { const c={critical:"#ef4444",high:"#f59e0b",medium:"#3b82f6",low:"#22c55e"}; return <Badge text={sev||"—"} color={c[sev]||"#9ca3af"}/>; }
function Mono({ children }) { return <span className="aihub_text_mono">{children}</span>; }
function Tag({ text, color="#6366f1" }) { return <span style={{display:"inline-block",padding:"2px 8px",borderRadius:6,fontSize:10,fontWeight:600,background:color+"12",color,marginRight:4,marginBottom:2,letterSpacing:"0.02em"}}>{text}</span>; }
function Loading() { return <div className="aihub_loading"><RefreshCw size={18} className="aihub_spin"/> Loading...</div>; }
function Err({msg}) { return <div className="aihub_error"><AlertTriangle size={14}/> {msg}</div>; }
function Empty({icon,title,msg}) { return <div className="aihub_empty">{icon}<h4>{title}</h4><p>{msg}</p></div>; }
/**
 * @param {function} [renderExpanded] - (row) => node. When supplied together with
 *   `isExpanded`, the returned node renders in a full-width row directly beneath
 *   its parent. Detail stays attached to the row it describes, which a side panel
 *   cannot do once the table scrolls.
 * @param {function} [isExpanded] - (row) => boolean.
 */
function DataTable({ columns, rows, empty, onRow, renderExpanded, isExpanded, paginate }) {
  const [page,setPage]=useState(0);
  const [pageSize,setPageSize]=useState(paginate||0);
  // Reset page when rows change
  useEffect(()=>setPage(0),[rows?.length]);
  const rowKey=(r,i)=>r.id||r.tool_key||r.host||i;
  const allRows=rows||[];
  const usePaging=pageSize>0&&allRows.length>pageSize;
  const visibleRows=usePaging?allRows.slice(page*pageSize,(page+1)*pageSize):allRows;
  const totalPages=usePaging?Math.ceil(allRows.length/pageSize):1;

  // Page numbers to show: current ± 2, plus first/last
  const pageNums=[];
  if(usePaging){
    const add=n=>{if(n>=0&&n<totalPages&&!pageNums.includes(n))pageNums.push(n)};
    add(0);
    for(let i=Math.max(0,page-2);i<=Math.min(totalPages-1,page+2);i++) add(i);
    add(totalPages-1);
    pageNums.sort((a,b)=>a-b);
  }

  return (<div>
    <div className="aihub_table_wrap"><table className="aihub_table"><thead><tr>{columns.map((c,i)=><th key={i} style={c.right?{textAlign:"right"}:undefined}>{c.label}</th>)}</tr></thead><tbody>{(!visibleRows.length)?<tr><td colSpan={columns.length} className="aihub_table_empty">{empty||"No data"}</td></tr>:visibleRows.map((r,i)=>{
    const open=isExpanded?.(r);
    return (<Fragment key={rowKey(r,i)}>
      <tr onClick={()=>onRow?.(r)} style={{cursor:onRow?"pointer":"default",background:open?"rgba(0,82,224,0.04)":undefined}}>
        {columns.map((c,j)=><td key={j} style={c.right?{textAlign:"right"}:undefined}>{c.render?c.render(r):r[c.key]??"—"}</td>)}
      </tr>
      {open&&renderExpanded&&<tr className="aihub_expanded_row"><td colSpan={columns.length} style={{padding:0,background:"#f5f6f8"}}>{renderExpanded(r)}</td></tr>}
    </Fragment>);
  })}</tbody></table></div>
    {(usePaging||paginate>0)&&<div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 6px",fontSize:12,color:"#4b5563"}}>
      <div style={{display:"flex",alignItems:"center",gap:8}}>
        <span style={{fontWeight:500}}>{allRows.length.toLocaleString()} rows</span>
        <select value={pageSize} onChange={e=>{setPageSize(Number(e.target.value));setPage(0);}} style={{padding:"4px 8px",border:"1px solid #e2e5ea",borderRadius:8,fontSize:11,background:"#fff",cursor:"pointer",fontFamily:"inherit"}}>
          {[10,25,50,100].map(n=><option key={n} value={n}>{n} / page</option>)}
        </select>
      </div>
      {usePaging&&<div style={{display:"flex",alignItems:"center",gap:4}}>
        <button disabled={page===0} onClick={()=>setPage(page-1)} style={{padding:"5px 12px",border:"1px solid #e2e5ea",borderRadius:8,fontSize:11,cursor:page===0?"default":"pointer",opacity:page===0?0.35:1,background:"#fff",fontWeight:600,fontFamily:"inherit",transition:"all 0.15s"}}>Prev</button>
        {pageNums.map((n,i)=>{
          const gap=i>0&&n-pageNums[i-1]>1;
          return <Fragment key={n}>{gap&&<span style={{padding:"0 4px",color:"#b0b6c0"}}>...</span>}<button onClick={()=>setPage(n)} style={{padding:"5px 10px",border:"1px solid "+(n===page?"#0052e0":"#e2e5ea"),borderRadius:8,fontSize:11,cursor:"pointer",background:n===page?"linear-gradient(135deg, #0052e0, #6366f1)":"#fff",color:n===page?"#fff":"#4b5563",fontWeight:n===page?700:500,fontFamily:"inherit",transition:"all 0.15s",boxShadow:n===page?"0 2px 6px rgba(0,82,224,0.2)":"none"}}>{n+1}</button></Fragment>;
        })}
        <button disabled={page>=totalPages-1} onClick={()=>setPage(page+1)} style={{padding:"5px 12px",border:"1px solid #e2e5ea",borderRadius:8,fontSize:11,cursor:page>=totalPages-1?"default":"pointer",opacity:page>=totalPages-1?0.35:1,background:"#fff",fontWeight:600,fontFamily:"inherit",transition:"all 0.15s"}}>Next</button>
      </div>}
    </div>}
  </div>);
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
            {/* The person leads the line: the first question about a flagged
                prompt is whose it was, and the drawer is where an admin lands. */}
            <div className="aihub_drawer_sub">{[meta?.user||meta?.hostname,service,meta?.event_kind,meta?.occurred_at&&relTime(meta.occurred_at)].filter(Boolean).join(" · ")}</div>
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
          {state.status==="ok" && state.kind==="image" && <div style={{padding:16,display:"flex",justifyContent:"center",background:"#f5f6f8",minHeight:"100%"}}><img src={url} alt={filename||""} style={{maxWidth:"100%",borderRadius:6}}/></div>}
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
// Every widget on this screen is a click-through to the page that owns the detail —
// the overview is a router, not a dead-end summary. Routes are collected here so a
// tab rename breaks one line rather than eight call sites.
const OV_ROUTE={
  machines:"/AIHub/PoliciesRisk?tab=risk",
  tools:"/AIHub/Inventory?tab=systems",
  dlp:"/AIHub/Activity?tab=prompts",
  agents:"/AIHub/Inventory?tab=agents",
  access:"/AIHub/AccessRequests",
  cost:"/AIHub/AgentGovernance?tab=cost",
  policies:"/AIHub/PoliciesRisk?tab=policies",
};
// Same hex values as SanctionBadge / SeverityBadge / RiskBadge above — one status
// colour per meaning across the whole screen.
const SANCTION_TONE={approved:"#22c55e",restricted:"#f59e0b",blocked:"#ef4444",unknown:"#9ca3af"};
const RISK_TONE={critical:"#ef4444",high:"#f59e0b",medium:"#3b82f6",low:"#22c55e",not_assessed:"#9ca3af"};
const SEV_TONE={critical:"#ef4444",high:"#f59e0b",medium:"#3b82f6",low:"#22c55e"};
const AUTONOMY_TONE={ai_app:"#0052e0",mcp:"#8b5cf6",ai_coding_agent:"#f59e0b",ai_agent:"#ef4444"};
const VENDOR_LABEL={microsoft:"Azure OpenAI",google:"Vertex AI",openai:"OpenAI",claude:"Anthropic",gemini:"Gemini Enterprise"};

/** Card that behaves like a link. role/tabIndex/keydown so it is reachable without a mouse. */
function ClickCard({ title, hint, onClick, children }) {
  return (<div className="aihub_card aihub_card_click" role="button" tabIndex={0}
               onClick={onClick} onKeyDown={e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();onClick();}}}>
    <SectionHeader title={title} hint={hint}/>
    {children}
  </div>);
}

// Hand-rolled SVG donut, matching the hand-rolled BarChart above rather than pulling
// a chart library into this file. The ring is dash-segments of a single circle, so the
// centre is a plain cutout — no number or text inside it by design.
function Donut({ segments, label, size=132, thickness=30 }) {
  const total=segments.reduce((s,x)=>s+x.value,0);
  const r=(size-thickness)/2, c=2*Math.PI*r;
  const [tip,setTip]=useState(null); // {label,value,pct,color,x,y}
  let off=0;
  return (<div style={{position:"relative",display:"inline-block",flexShrink:0}}>
    <svg className="aihub_donut" width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label}
      onMouseLeave={()=>setTip(null)}>
      <g transform={`rotate(-90 ${size/2} ${size/2})`}>
        {total===0
          ? <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#f3f4f6" strokeWidth={thickness}/>
          : segments.filter(s=>s.value>0).map(s=>{
              const len=c*(s.value/total);
              const pct=Math.round((s.value/total)*100);
              const mid=off+len/2;
              const angle=(mid/c)*360-90;
              const rad=angle*Math.PI/180;
              const tx=size/2+Math.cos(rad)*(r*0.6);
              const ty=size/2+Math.sin(rad)*(r*0.6);
              const arc=(<circle key={s.key} cx={size/2} cy={size/2} r={r} fill="none" stroke={s.color}
                                strokeWidth={thickness} strokeDasharray={`${len} ${c-len}`} strokeDashoffset={-off}
                                style={{cursor:"pointer",transition:"opacity 0.15s"}}
                                onMouseEnter={()=>setTip({label:s.label,value:s.value,pct,color:s.color,x:tx,y:ty})}
                                />);
              off+=len; return arc;
            })}
      </g>
    </svg>
    {tip&&<div style={{
      position:"absolute",left:tip.x,top:tip.y,transform:"translate(-50%,-120%)",
      background:"#111827",color:"#fff",borderRadius:10,padding:"8px 14px",
      fontSize:12,fontWeight:600,whiteSpace:"nowrap",pointerEvents:"none",
      boxShadow:"0 4px 16px rgba(0,0,0,0.18)",zIndex:10,
      animation:"polFadeIn 0.12s ease-out",
    }}>
      <div style={{display:"flex",alignItems:"center",gap:7}}>
        <span style={{width:8,height:8,borderRadius:3,background:tip.color,flexShrink:0}}/>
        {tip.label}
      </div>
      <div style={{display:"flex",justifyContent:"space-between",gap:16,marginTop:4,fontSize:11,color:"rgba(255,255,255,0.65)"}}>
        <span>{tip.value.toLocaleString()}</span>
        <span>{tip.pct}%</span>
      </div>
      <div style={{position:"absolute",bottom:-5,left:"50%",transform:"translateX(-50%)",width:10,height:10,background:"#111827",borderRadius:2,rotate:"45deg"}}/>
    </div>}
  </div>);
}

// Headline total on top, donut below, swatch+label legend beside it. The legend
// deliberately carries no per-slice counts — the breakdown lives on the page this
// card opens. Counts are still in the chart's aria-label for screen readers.
function DonutCard({ title, hint, segments, onClick, unavailable }) {
  const total=segments.reduce((s,x)=>s+x.value,0);
  const loading = unavailable;
  return (<ClickCard title={title} hint={hint} onClick={onClick}>
    {loading ? <>
      <div><span className="aihub_shimmer_block" style={{width:64,height:28,borderRadius:6}}/></div>
      <div className="aihub_chart_total_label">total</div>
      <div className="aihub_donut_wrap">
        <div style={{width:132,height:132,borderRadius:"50%",background:"#f3f4f6"}}/>
        <ul className="aihub_legend">
          {segments.map(s=><li key={s.key}><span className="aihub_legend_dot" style={{background:"#e2e5ea"}}/><span className="aihub_shimmer_block" style={{width:70,height:14,borderRadius:4}}/></li>)}
        </ul>
      </div>
    </> : <>
      <div className="aihub_chart_total">{total.toLocaleString()}</div>
      <div className="aihub_chart_total_label">total</div>
      <div className="aihub_donut_wrap">
        <Donut segments={segments} label={`${title} — ${segments.map(s=>`${s.label}: ${s.value}`).join(", ")}`}/>
        <ul className="aihub_legend">
          {segments.map(s=><li key={s.key}><span className="aihub_legend_dot" style={{background:s.color}}/>{s.label} <strong style={{marginLeft:"auto",fontWeight:700,color:"#111"}}>{s.value.toLocaleString()}</strong></li>)}
        </ul>
      </div>
    </>}
  </ClickCard>);
}

/** Single card with toggle buttons to switch between two donut views. */
function ToggleDonutCard({ views, onClick, unavailable }) {
  const [active,setActive]=useState(0);
  const v=views[active];
  const total=v.segments.reduce((s,x)=>s+x.value,0);
  return (<ClickCard title={v.title} hint={v.hint} onClick={onClick}>
    {/* Toggle pills */}
    <div style={{display:"flex",gap:4,marginBottom:14}}>
      {views.map((vw,i)=>(
        <button key={vw.key} onClick={e=>{e.stopPropagation();setActive(i);}}
          style={{padding:"4px 12px",borderRadius:20,border:"1px solid "+(i===active?"#0052e0":"#e2e5ea"),
            background:i===active?"#0052e0":"#fff",color:i===active?"#fff":"#6b7280",
            fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"inherit",transition:"all 0.15s"}}>
          {vw.label}
        </button>
      ))}
    </div>
    {unavailable ? <>
      <div><span className="aihub_shimmer_block" style={{width:64,height:28,borderRadius:6}}/></div>
      <div className="aihub_chart_total_label">total</div>
      <div className="aihub_donut_wrap">
        <div style={{width:132,height:132,borderRadius:"50%",background:"#f3f4f6"}}/>
        <ul className="aihub_legend">
          {v.segments.map(s=><li key={s.key}><span className="aihub_legend_dot" style={{background:"#e2e5ea"}}/><span className="aihub_shimmer_block" style={{width:70,height:14,borderRadius:4}}/></li>)}
        </ul>
      </div>
    </> : <>
      <div className="aihub_chart_total">{total.toLocaleString()}</div>
      <div className="aihub_chart_total_label">total</div>
      <div className="aihub_donut_wrap">
        <Donut segments={v.segments} label={`${v.title} — ${v.segments.map(s=>`${s.label}: ${s.value}`).join(", ")}`}/>
        <ul className="aihub_legend">
          {v.segments.map(s=><li key={s.key}><span className="aihub_legend_dot" style={{background:s.color}}/>{s.label} <strong style={{marginLeft:"auto",fontWeight:700,color:"#111"}}>{s.value.toLocaleString()}</strong></li>)}
        </ul>
      </div>
    </>}
  </ClickCard>);
}

// One stacked bar: proportional widths for apps / MCP servers / coding agents /
// autonomous agents. Counts DO show in this legend — it is the only place they appear.
function AutonomyCard({ segments, onClick, unavailable }) {
  const total=segments.reduce((s,x)=>s+x.value,0);
  return (<ClickCard title="Agent autonomy" hint="How much of the AI footprint can act on its own." onClick={onClick}>
    {unavailable ? <div>
      <div className="aihub_seg_bar" style={{background:"#f3f4f6"}}><div className="aihub_seg_empty"/></div>
      <ul className="aihub_seg_legend">{segments.map(s=><li key={s.key}><span className="aihub_legend_dot" style={{background:"#e2e5ea"}}/><span className="aihub_shimmer_block" style={{width:60,height:12,borderRadius:4}}/></li>)}</ul>
    </div> : <>
      <div className="aihub_seg_bar" role="img" aria-label={`Agent autonomy — ${segments.map(s=>`${s.label}: ${s.value}`).join(", ")}`}>
        {total===0
          ? <div className="aihub_seg_empty"/>
          : segments.filter(s=>s.value>0).map(s=><div key={s.key} className="aihub_seg" title={`${s.label}: ${s.value.toLocaleString()} (${Math.round((s.value/total)*100)}%)`} style={{width:`${(s.value/total)*100}%`,background:s.color}}/>)}
      </div>
      <ul className="aihub_seg_legend">
        {segments.map(s=><li key={s.key}><span className="aihub_legend_dot" style={{background:s.color}}/>{s.label}<strong>{s.value.toLocaleString()}</strong></li>)}
      </ul>
      {total===0 && <p className="aihub_text_muted" style={{marginTop:8}}>No agent projects or MCP servers detected yet.</p>}
    </>}
  </ClickCard>);
}

/** One row of "Needs attention". Real link semantics, one real destination each. */
function AttnItem({ tone, icon, label, sub, onClick }) {
  return (<li><button className="aihub_attn_item" onClick={onClick}>
    <span className="aihub_attn_icon" style={{background:tone+"14",color:tone}}>{icon}</span>
    <span className="aihub_attn_text"><span className="aihub_attn_label">{label}</span><span className="aihub_attn_sub">{sub}</span></span>
    <ChevronRight size={14} className="aihub_attn_chev"/>
  </button></li>);
}

// LLM spend KPI. Reads the same credentials and cost endpoints as Agent Governance →
// Cost (see tabs/CostTab.jsx), but shows the RAW 30-day total: this tile deliberately
// skips CostTab's subscription / free-tier subtraction. Must be mounted inside
// <AgentGovernanceProvider> because it uses useAgentAuth(). With no vendor credential
// it says "Not connected" rather than an invented $0, and still navigates through.
function SpendCard({ onClick }) {
  const { oauthKeyId, googleKeyId, openaiKeyId, claudeKeyId, geminiEnterpriseKeyId }=useAgentAuth();
  const vendor=oauthKeyId?"microsoft":googleKeyId?"google":openaiKeyId?"openai":claudeKeyId?"claude":geminiEnterpriseKeyId?"gemini":null;
  const [st,setSt]=useState({status:"none"});
  useEffect(()=>{
    if(!vendor){setSt({status:"none"});return;}
    let dead=false; setSt({status:"loading"});
    (async()=>{
      try{
        const d=vendor==="microsoft"?await agentGovernanceApi.fetchAzureCost(oauthKeyId,"P30D")
          :vendor==="google"?await agentGovernanceApi.fetchGoogleCost(googleKeyId,30)
          :vendor==="openai"?await agentGovernanceApi.fetchOpenAICost(openaiKeyId,"P30D")
          :vendor==="claude"?await agentGovernanceApi.fetchClaudeUsage(claudeKeyId,"P30D")
          :await agentGovernanceApi.fetchGeminiEnterpriseCost(geminiEnterpriseKeyId,30);
        if(!dead) setSt({status:"ok",total:Number(d?.summary?.totalCost ?? d?.estimatedTotalCost ?? 0)});
      }catch{ if(!dead) setSt({status:"error"}); }
    })();
    return ()=>{dead=true};
  },[vendor,oauthKeyId,googleKeyId,openaiKeyId,claudeKeyId,geminiEnterpriseKeyId]);
  const value=st.status==="ok"?fmtUsd(st.total):st.status==="loading"?"…":st.status==="error"?"—":"Not connected";
  const hint=st.status==="ok"?`This month · ${VENDOR_LABEL[vendor]}`
    :st.status==="loading"?"Reading provider usage…"
    :st.status==="error"?"Cost unavailable — check the connection"
    :"Connect a provider to see spend";
  return <StatCard icon={<DollarSign size={18}/>} label="LLM spend" value={value} hint={hint} color="#22c55e" onClick={onClick}/>;
}

function OverviewView() {
  const nav=useNavigate();
  const [d,setD]=useState(null),[e,setE]=useState(null);
  const [reg,setReg]=useState(null),[dlp,setDlp]=useState(null),[mcp,setMcp]=useState(null);
  const [proj,setProj]=useState(null),[reqs,setReqs]=useState(null),[hiEv,setHiEv]=useState(null);
  const [toolsCount,setToolsCount]=useState(null);
  const [toolsStatus,setToolsStatus]=useState({}); // {approved:N, restricted:N, blocked:N, unknown:N}
  const [toolsRisk,setToolsRisk]=useState({}); // {critical:N, high:N, medium:N, low:N, not_assessed:N}
  const [dlpCount,setDlpCount]=useState(null);
  const [warn,setWarn]=useState([]);
  useEffect(()=>{
    const soft=(p,label,setter,fallback)=>p.then(setter).catch(()=>{setter(fallback);setWarn(w=>w.includes(label)?w:[...w,label]);});
    apiFetch("/overview").then(setD).catch(x=>setE(x.message));
    soft(apiFetch("/registry/summary"),"AI systems registry",setReg,false);
    soft(apiFetch("/dlp/summary"),"prompt & DLP activity",setDlp,false);
    soft(apiFetch("/findings?type=mcp_server&latestOnly=true&limit=500"),"MCP servers",setMcp,false);
    soft(apiFetch("/findings?type=agent_project&latestOnly=true&limit=500"),"agent projects",setProj,false);
    // adminJson, not apiFetch: /access-requests is behind requireAdminAuth, so
    // apiFetch's credential-less GET now 401s and this tile would read "0
    // pending" forever. soft() still handles the no-token build — the count
    // falls back and the warning strip names "access requests" — but with a
    // token the number is real again.
    soft(adminJson("/access-requests"),"access requests",setReqs,false);
    soft(apiFetch("/dlp?severity=critical,high&limit=1"),"recent detections",setHiEv,false);
    // Exact same count DLPView shows: fetch actual events + files, count high/critical
    Promise.all([apiFetch("/dlp?limit=5000").catch(()=>[]),apiFetch("/dlp/files?limit=5000").catch(()=>[])]).then(([ev,f])=>{
      const prompts=(ev||[]).filter(e=>e.event_kind!=="file_upload");
      const files=f||[];
      setDlpCount(prompts.filter(e=>isHiCrit(e.secret_class||e.highest_severity)).length+files.filter(e=>isHiCrit(e.severity||e.highest_severity)).length);
    }).catch(()=>{});
    // Exact same merge the Inventory page does: registry + deduped platform catalog
    Promise.all([apiFetch("/registry"),apiFetch("/ai-platforms").catch(()=>[])]).then(([regList,plats])=>{
      const seen=new Set();
      const allRows=[...(regList||[])];
      for(const r of allRows){if(r.name) seen.add(String(r.name).toLowerCase()); if(r.source_host) seen.add(String(r.source_host).toLowerCase());}
      // Cross-reference blocked status from ai_platforms — same as Inventory
      const blockedHosts=new Set((Array.isArray(plats)?plats:[]).filter(p=>p.blocked).map(p=>p.host));
      const platByHost=new Map((Array.isArray(plats)?plats:[]).map(p=>[p.host,p]));
      for(const r of allRows){
        const hosts=r.matched_hosts||[];
        let isBlocked=hosts.some(h=>blockedHosts.has(h));
        if(!isBlocked&&!hosts.length){
          const lower=(r.name||"").toLowerCase();
          for(const [h,p] of platByHost){if(h.includes(lower)&&p.blocked){isBlocked=true;break;}}
        }
        if(isBlocked&&r.status!=="blocked") r.status="blocked";
        else if(!isBlocked&&r.status==="blocked") r.status="approved";
      }
      for(const p of (Array.isArray(plats)?plats:[])){
        const k=String(p.product||p.host||"").toLowerCase();
        if(!k||seen.has(k)||seen.has(String(p.host||"").toLowerCase())) continue;
        seen.add(k);
        allRows.push({status:p.blocked?"blocked":p.governed?"approved":"unknown",risk_level:null});
      }
      setToolsCount(allRows.length);
      const st={approved:0,restricted:0,blocked:0,unknown:0};
      const rk={critical:0,high:0,medium:0,low:0,not_assessed:0};
      for(const r of allRows){
        st[r.status]=(st[r.status]||0)+1;
        rk[r.risk_level||"not_assessed"]=(rk[r.risk_level||"not_assessed"]||0)+1;
      }
      setToolsStatus(st);
      setToolsRisk(rk);
    }).catch(()=>{});
  },[]);
  if(e) return <Err msg={e}/>;
  if(!d) return <Loading/>;

  const byStatus=toolsStatus, byRisk=toolsRisk;
  const sev={}; ((dlp&&dlp.bySeverity)||[]).forEach(s=>{sev[s.severity]=(sev[s.severity]||0)+(s.events||0)});
  // Same bucketing AgentsView uses: payload.primaryCategory, defaulting to ai_app.
  const cats={ai_agent:0,ai_coding_agent:0,ai_app:0};
  (Array.isArray(proj)?proj:[]).forEach(f=>{const c=f.payload?.primaryCategory||"ai_app"; if(cats[c]!=null) cats[c]+=1;});
  const mcpCount=Array.isArray(mcp)?mcp.length:0;
  const autonomy=mcpCount+cats.ai_agent+cats.ai_coding_agent+cats.ai_app;
  const pending=(Array.isArray(reqs)?reqs:[]).filter(r=>r.status==="pending").length;
  const ev=Array.isArray(hiEv)?hiEv[0]:null;
  const noAutonomy=mcp===false&&proj===false;   // both endpoints failed — 0 would be a lie

  const sanctionSegs=[
    {key:"approved",label:"Allowed",value:byStatus.approved||0,color:SANCTION_TONE.approved},
    {key:"unreviewed",label:"Unreviewed",value:(byStatus.restricted||0)+(byStatus.unknown||0),color:SANCTION_TONE.restricted},
    {key:"blocked",label:"Blocked",value:byStatus.blocked||0,color:SANCTION_TONE.blocked},
  ];
  const riskSegs=[
    {key:"critical",label:"Critical",value:byRisk.critical||0,color:RISK_TONE.critical},
    {key:"high",label:"High",value:byRisk.high||0,color:RISK_TONE.high},
    {key:"medium",label:"Medium",value:byRisk.medium||0,color:RISK_TONE.medium},
    {key:"low",label:"Low",value:byRisk.low||0,color:RISK_TONE.low},
    {key:"not_assessed",label:"Not assessed",value:byRisk.not_assessed||0,color:RISK_TONE.not_assessed},
  ];
  const autonomySegs=[
    {key:"ai_app",label:"AI-using apps",value:cats.ai_app,color:AUTONOMY_TONE.ai_app},
    {key:"mcp",label:"MCP servers",value:mcpCount,color:AUTONOMY_TONE.mcp},
    {key:"ai_coding_agent",label:"AI coding agents",value:cats.ai_coding_agent,color:AUTONOMY_TONE.ai_coding_agent},
    {key:"ai_agent",label:"Autonomous agents",value:cats.ai_agent,color:AUTONOMY_TONE.ai_agent},
  ];

  // Max 4 rows, only for things that are actually outstanding. Never renders captured
  // prompt text — service, severity and time only.
  const attn=[];
  if(ev) attn.push({key:"ev",tone:SEV_TONE[ev.secret_class||ev.severity]||SEV_TONE.high,icon:<ShieldAlert size={14}/>,
    label:`${(ev.secret_class||ev.severity||"high")} detection in ${ev.platform?.product||ev.ai_service||"an AI tool"}`,
    sub:`Latest sensitive-data hit · ${relTime(ev.occurred_at)}`,to:OV_ROUTE.dlp});
  if(pending>0) attn.push({key:"req",tone:"#f59e0b",icon:<Clock size={14}/>,
    label:`${pending} access request${pending===1?"":"s"} awaiting review`,sub:"Employees stay blocked until reviewed",to:OV_ROUTE.access});
  if(byStatus.unknown>0) attn.push({key:"unsanctioned",tone:"#8b5cf6",icon:<Wrench size={14}/>,
    label:`${byStatus.unknown} tools with no sanction decision`,sub:"Approve, restrict or block them",to:OV_ROUTE.tools});
  if(byRisk.not_assessed>0) attn.push({key:"risk",tone:"#0052e0",icon:<Shield size={14}/>,
    label:`${byRisk.not_assessed} tools not risk-assessed`,sub:"No risk level recorded yet",to:"/AIHub/Inventory?tab=systems&showAll=1&risk=not_assessed"});

  const links=[
    {label:"EU AI Act",href:"https://artificialintelligenceact.eu/"},
    {label:"NIST AI RMF",href:"https://www.nist.gov/itl/ai-risk-management-framework"},
    {label:"ISO/IEC 42001",href:"https://www.iso.org/standard/81230.html"},
    {label:"AI use policy",to:OV_ROUTE.policies},
    {label:"Request a tool",to:OV_ROUTE.access},
  ];

  return (<div>
    <SectionHeader title="Overview" hint="Every AI tool, agent and activity across your organization — click any card to see the full detail."/>

    {warn.length>0 && <div className="aihub_ov_warn"><AlertTriangle size={14}/> Could not load {warn.join(", ")}. Those panels may be incomplete.</div>}

    {/* 1. KPI strip */}
    <div className="aihub_stat_grid">
      <StatCard icon={<Monitor size={18}/>} label="Machines" value={d.totals.machines} hint="Reporting endpoints" color="#0052e0" onClick={()=>nav(OV_ROUTE.machines)}/>
      <StatCard icon={<Wrench size={18}/>} label="AI tools & systems"
                value={toolsCount!=null?toolsCount:"…"}
                hint="In the AI registry" color="#8b5cf6" onClick={()=>nav("/AIHub/Inventory?tab=systems&showAll=1")}/>
      <StatCard icon={<ShieldAlert size={18}/>} label="DLP events" value={dlpCount!=null?dlpCount:"…"} hint="High/critical flagged" color="#ef4444" onClick={()=>nav(OV_ROUTE.dlp)}/>
      <StatCard icon={<Bot size={18}/>} label="Autonomy" value={noAutonomy?"—":autonomy} hint={noAutonomy?"Counts unavailable":"Agents & MCP servers"} color="#f59e0b" onClick={()=>nav(OV_ROUTE.agents)}/>
    </div>

    {/* 2. Open governance items — two real counts */}
    <div className="aihub_gov_banner">
      <button className="aihub_gov_stat" onClick={()=>nav("/AIHub/Inventory?tab=systems&showAll=1&risk=not_assessed")}>
        <span className="aihub_gov_num">{toolsCount==null?<span className="aihub_shimmer_block" style={{width:24,height:20,borderRadius:4}}/>:(byRisk.not_assessed||0)}</span>
        <span className="aihub_gov_txt">tools not yet risk-assessed</span>
        <ChevronRight size={14}/>
      </button>
      <span className="aihub_gov_div"/>
      <button className="aihub_gov_stat" onClick={()=>nav(OV_ROUTE.access)}>
        <span className="aihub_gov_num">{reqs===false?"—":pending}</span>
        <span className="aihub_gov_txt">access requests pending</span>
        <ChevronRight size={14}/>
      </button>
    </div>

    {/* 3. Six equal insight cards */}
    <div className="aihub_ov_grid">
      <ToggleDonutCard
        views={[
          {key:"sanction",label:"By Status",title:"Tools by sanction",hint:"Allow/block decision per AI system.",segments:sanctionSegs},
          {key:"risk",label:"By Risk",title:"Tools by risk level",hint:"Assessed risk per AI system.",segments:riskSegs},
        ]}
        unavailable={toolsCount==null}
        onClick={()=>nav(OV_ROUTE.tools)}
      />
      <div className="aihub_card">
        <SectionHeader title="Needs attention" hint="Open items — each one links to where it is handled."/>
        {attn.length===0
          ? <div style={{display:"flex",flexDirection:"column",alignItems:"center",padding:"24px 0",color:"#b0b6c0"}}>
              <Shield size={28} strokeWidth={1.5}/>
              <p style={{margin:"10px 0 0",fontSize:13,fontWeight:500,color:"#4b5563"}}>{warn.length>0?"Some panels could not load.":"All clear — nothing outstanding."}</p>
            </div>
          : <ul className="aihub_attn_list">{attn.slice(0,4).map(a=><AttnItem key={a.key} tone={a.tone} icon={a.icon} label={a.label} sub={a.sub} onClick={()=>nav(a.to)}/>)}</ul>}
      </div>
      <div className="aihub_card">
        <SectionHeader title="Quick links" hint="Frameworks and compliance references."/>
        <div className="aihub_quick_links">
          {links.map(l=>l.href
            ? <a key={l.label} className="aihub_quick_link" href={l.href} target="_blank" rel="noreferrer">{l.label}<ExternalLink size={11}/></a>
            : <button key={l.label} className="aihub_quick_link" onClick={()=>nav(l.to)}>{l.label}<ChevronRight size={12}/></button>)}
        </div>
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
  const platTone={win32:"#0052e0",darwin:"#6b7280",linux:"#f59e0b"};
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
  // agent_config and desktop_hook_status are no longer fetched — the two tables
  // that consumed them were removed, and leaving the requests in would cost two
  // round-trips per mount for data nothing renders.
  const [mcp,setMcp]=useState(null),[projects,setProjects]=useState(null),[machines,setMachines]=useState(null),[e,setE]=useState(null);
  // "" = every section stacked (the original default). Otherwise only the named
  // section renders — clicking that section's stat card again clears it.
  const [filterSection,setFilterSection]=useState("");
  const [filterUser,setFilterUser]=useState("");
  useEffect(()=>{
    Promise.all([
      apiFetch("/findings?type=mcp_server&latestOnly=true&limit=500"),
      apiFetch("/findings?type=agent_project&latestOnly=true&limit=500"),
      // mcp_server / agent_project findings only carry machine_id, so the machine
      // list is what resolves a finding to a person. Soft-failed on purpose:
      // losing it should degrade every row to "Unknown", not blank the inventory.
      apiFetch("/machines").catch(()=>[]),
    ]).then(([m,p,mach])=>{setMcp(m);setProjects(p);setMachines(mach)}).catch(x=>setE(x.message));
  },[]);
  if(e) return <Err msg={e}/>; if(!mcp||!machines) return <Loading/>;

  const mcpAll=Array.isArray(mcp)?mcp:[];
  const projectsAll=Array.isArray(projects)?projects:[];
  const catMap={ai_agent:{title:"Autonomous AI agents",hint:"Projects using agent frameworks (LangChain, AutoGen, CrewAI, LlamaIndex, MCP SDK)",color:"#ef4444"},ai_coding_agent:{title:"AI coding agents",hint:"Projects managed by Claude Code, Cursor, Aider, Continue",color:"#f59e0b"},ai_app:{title:"AI-using apps",hint:"Projects that call LLM APIs",color:"#0052e0"}};
  const grouped={ai_agent:[],ai_coding_agent:[],ai_app:[]};
  projectsAll.forEach(f=>{const c=f.payload?.primaryCategory||"ai_app";(grouped[c]||(grouped[c]=[])).push(f)});

  // machine_id → machine row. A finding pointing at a machine that was deleted or
  // never enrolled keeps its row and lands in the "Unknown" bucket instead of
  // disappearing from the inventory.
  const UNKNOWN_USER="Unknown";
  const machineById=new Map((Array.isArray(machines)?machines:[]).map(m=>[m.id,m]));
  const userKey=r=>{const m=machineById.get(r.machine_id); return m?.user||m?.hostname||UNKNOWN_USER;};
  const renderUser=r=>{
    const m=machineById.get(r.machine_id);
    const label=m?.user||m?.hostname;
    if(label) return <><div className="aihub_text_primary">{label}</div>{m?.user&&m?.hostname&&<div className="aihub_text_muted">{m.hostname}</div>}</>;
    // Unresolved: name the bucket, then the raw id so the row is still traceable.
    return <><div className="aihub_text_muted">{UNKNOWN_USER}</div><Mono>{(r.machine_id||"").slice(0,10)||"—"}</Mono></>;
  };

  // Users actually present across both finding sets; "Unknown" sorts last so the
  // real people stay at the top of the dropdown.
  const userOptions=[...new Set([...mcpAll,...projectsAll].map(userKey))]
    .sort((a,b)=>a===UNKNOWN_USER?1:b===UNKNOWN_USER?-1:a.localeCompare(b));

  // Section toggle and user filter are independent dimensions — both apply.
  const matchUser=r=>!filterUser||userKey(r)===filterUser;
  const mcpRows=mcpAll.filter(matchUser);
  const catRows=cat=>(grouped[cat]||[]).filter(matchUser);
  const showSection=key=>filterSection===key; // nothing shows until a card is clicked
  const toggleSection=key=>setFilterSection(filterSection===key?"":key);
  const visibleCount=(showSection("mcp")?mcpRows.length:0)+Object.keys(catMap).reduce((n,c)=>n+(showSection(c)?catRows(c).length:0),0);
  const totalHint=n=>filterUser?`of ${n} total`:undefined;

  const machineCol={label:"Machine",render:r=><Mono>{(r.machine_id||"").slice(0,10)}</Mono>};
  const userCol={label:"User",render:renderUser};

  return (<div>
    <SectionHeader title="Agents & MCP" hint="AI agent projects and the MCP servers they can reach, across all machines."
      action={<div style={{display:"flex",gap:10,alignItems:"center"}}>
        <select value={filterUser} onChange={ev=>setFilterUser(ev.target.value)} aria-label="Filter by user" style={{padding:"6px 10px",border:"1px solid #e5e7eb",borderRadius:8,fontSize:12,fontWeight:600}}>
          <option value="">All users</option>
          {userOptions.map(u=><option key={u} value={u}>{u}</option>)}
        </select>
        {filterSection&&<button className="aihub_filter_btn" onClick={()=>setFilterSection("")}>Clear selection</button>}
      </div>}/>

    {/* Summary cards — click one to open just that list, click again to show all.
        Counts follow the visible pool, so they track the user filter. */}
    <div className="aihub_stat_grid" style={{gridTemplateColumns:"repeat(4, 1fr)"}}>
      <StatCard icon={<Server size={18}/>} label="MCP servers" value={mcpRows.length} hint={totalHint(mcpAll.length)||"Capabilities granted to agents"} color={AUTONOMY_TONE.mcp} onClick={()=>toggleSection("mcp")}/>
      <StatCard icon={<Bot size={18}/>} label="Autonomous agents" value={catRows("ai_agent").length} hint={totalHint(grouped.ai_agent.length)||"Agent frameworks"} color={catMap.ai_agent.color} onClick={()=>toggleSection("ai_agent")}/>
      <StatCard icon={<Wrench size={18}/>} label="AI coding agents" value={catRows("ai_coding_agent").length} hint={totalHint(grouped.ai_coding_agent.length)||"Claude Code, Cursor, Aider"} color={catMap.ai_coding_agent.color} onClick={()=>toggleSection("ai_coding_agent")}/>
      <StatCard icon={<Monitor size={18}/>} label="AI-using apps" value={catRows("ai_app").length} hint={totalHint(grouped.ai_app.length)||"Projects calling LLM APIs"} color={catMap.ai_app.color} onClick={()=>toggleSection("ai_app")}/>
    </div>

    {/* MCP Servers */}
    {showSection("mcp")&&<div className="aihub_card">
      <SectionHeader title="MCP servers in use" hint="Each MCP server is a capability granted to an AI agent."/>
      <DataTable columns={[
        userCol,
        machineCol,
        {label:"Client",render:r=>r.payload?.client||"—"},
        {label:"Server",render:r=><span className="aihub_text_primary">{r.payload?.serverName||"—"}</span>},
        {label:"Scopes",render:r=><div style={{display:"flex",flexWrap:"wrap",gap:2}}>{(r.payload?.scopes||[]).map((s,i)=><Tag key={i} text={s}/>)}</div>},
        {label:"Command",render:r=><Mono>{[r.payload?.command,...(r.payload?.args||[])].filter(Boolean).join(" ").slice(0,60)}</Mono>},
        {label:"Config file",render:r=>r.payload?.configPath?<Mono title={r.payload.configPath}>{r.payload.configPath}</Mono>:<span className="aihub_text_muted">—</span>},
      ]} rows={mcpRows} empty={filterUser?`No MCP servers for ${filterUser}`:"No MCP servers found"}/>
    </div>}

    {/* Agent project categories */}
    {Object.entries(catMap).filter(([cat])=>showSection(cat)).map(([cat,cfg])=>(
      <div className="aihub_card" key={cat}>
        <SectionHeader title={cfg.title} hint={cfg.hint}/>
        <DataTable columns={[
          userCol,
          machineCol,
          {label:"Path",render:r=><Mono>{r.payload?.path||"—"}</Mono>},
          {label:"Language",render:r=>r.payload?.language||"—"},
          {label:"Frameworks",render:r=><div style={{display:"flex",flexWrap:"wrap",gap:2}}>{(r.payload?.frameworks||[]).map((f,i)=><Tag key={i} text={f} color={cfg.color}/>)}</div>},
          {label:"Modified",render:r=>relTime(r.payload?.lastModified)},
        ]} rows={catRows(cat)} empty={filterUser?`No ${cfg.title.toLowerCase()} for ${filterUser}`:`No ${cfg.title.toLowerCase()} found`}/>
      </div>
    ))}

    {/* "Desktop hook coverage" and "Agent configurations" were removed from this
        view. Both were endpoint-diagnostic tables — which Electron apps the hook
        injected into, and which config files exist on which machine — rather than
        an inventory of AI systems, which is what this screen is for. Their
        findings are still captured and stored; they are simply no longer surfaced
        here. Re-add by restoring the two /findings fetches (types
        desktop_hook_status and agent_config) alongside their tables. */}
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

  const triggerTone={interactive_shell:"#0052e0",cron:"#8b5cf6",systemd:"#0891b2",ssh:"#f59e0b",ci:"#22c55e",container:"#6366f1",login:"#9ca3af"};
  const providerTone={openai:"#10a37f",anthropic:"#d4622a",google:"#4285f4","openai-azure":"#0078d4","aws-bedrock":"#ff9900"};

  return (<div>
    <SectionHeader title="Server Agents" hint="LLM API calls intercepted from backend servers."/>
    <div className="aihub_stat_grid">
      <StatCard icon={<Activity size={18}/>} label="Calls observed" value={summary.totals.calls||0} color="#0052e0"/>
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
  const [preview,setPreview]=useState(null);
  const [section,setSection]=useState(""); // "", "prompts", "files", "services"
  const [openRows,setOpenRows]=useState(()=>new Set()); // grouped rows expanded to show their members
  const toggleRow=id=>setOpenRows(prev=>{const n=new Set(prev);n.has(id)?n.delete(id):n.add(id);return n;});
  useEffect(()=>{
    Promise.all([apiFetch("/dlp/summary").catch(()=>null),apiFetch("/dlp?limit=5000").catch(()=>[]),apiFetch("/dlp/files?limit=5000").catch(()=>[])]).then(([s,ev,f])=>{setS(s);setEv(ev);setF(f)}).catch(x=>setE(x.message));
  },[]);
  if(e) return <Err msg={e}/>; if(!events) return <Loading/>;

  const allPrompts=(events||[]).filter(ev=>ev.event_kind!=="file_upload");
  const allFiles=files||[];
  const highCrit=allPrompts.filter(ev=>isHiCrit(ev.secret_class||ev.highest_severity)).length + allFiles.filter(f=>isHiCrit(f.severity||f.highest_severity)).length;
  const serviceCount=(summary?.byService||[]).length;
  const sourceTone={browser_extension:"#0052e0",desktop_hook:"#8b5cf6",os_monitor:"#f59e0b"};
  const toggle=k=>setSection(section===k?"":k);

  // High and critical only, always. The severity dropdown that used to switch
  // this to "all severities" is gone: low and medium detections are noise on a
  // reviewer's screen — 1842 of 2000 events carry no severity class at all — and
  // an "all" mode that buries 148 real findings under them is a worse default
  // than no choice. Nothing is deleted; the events are still stored and still
  // feed Claude Usage, Conversations and the per-service breakdown. This is a
  // view-level scope, not a retention policy.
  const promptRows=allPrompts.filter(ev=>isHiCrit(ev.secret_class||ev.highest_severity));
  const fileRows=allFiles.filter(f=>isHiCrit(f.severity||f.highest_severity));
  // Grouped AFTER the severity narrowing, so a row never folds in a member the
  // table excludes — the expanded members are always exactly the rows shown, and
  // the "N events" count never disagrees with the table.
  const promptGroups=groupDlpEvents(promptRows);

  return (<div>
    {/* The severity scope moves into the hint now that it is fixed — with no
        dropdown on screen, an unstated filter is an invisible one. */}
    <SectionHeader title="AI Activity (DLP)" hint="Clipboard, typed prompts, and file upload events captured by the OS monitor and browser extension. High and critical severity only."
      action={section?<button className="aihub_filter_btn" onClick={()=>setSection("")}>Clear selection</button>:null}/>

    <div className="aihub_stat_grid" style={{gridTemplateColumns:"repeat(4,1fr)"}}>
      <StatCard icon={<AlertTriangle size={18}/>} label="High / critical" value={highCrit} hint="total flagged" color="#ef4444"/>
      <StatCard icon={<MessageSquare size={18}/>} label="Prompt events" value={promptRows.length} hint="high & critical" color="#0052e0" onClick={()=>toggle("prompts")}/>
      <StatCard icon={<FileText size={18}/>} label="File uploads" value={fileRows.length} hint="high & critical" color="#f59e0b" onClick={()=>toggle("files")}/>
      <StatCard icon={<Server size={18}/>} label="AI services" value={serviceCount} hint="breakdown" color="#8b5cf6" onClick={()=>toggle("services")}/>
    </div>

    {section==="services"&&summary?.byService?.length>0&&<div className="aihub_card">
      <SectionHeader title="Activity by AI service"/>
      <DataTable columns={[
        {label:"Service",key:"ai_service"},
        {label:"Prompts",key:"prompts",right:true},
        {label:"File uploads",key:"file_uploads",right:true},
        {label:"Total",key:"events",right:true},
        {label:"Machines",key:"machines",right:true},
      ]} rows={summary.byService||[]}/>
    </div>}

    {section==="prompts"&&<div className="aihub_card">
      {/* Rows are user ACTIONS, not raw events — a prompt and the block it
          triggered are one action. Both counts are stated so the difference from
          the "Prompt events" card above is visible rather than mysterious. */}
      <SectionHeader title="Sensitive prompts"
        hint={`${promptGroups.length} actions from ${promptRows.length} events · high & critical severity only`}/>
      <DataTable onRow={r=>{ const c=contentMember(r); if(c) setPreview(c); }}
        isExpanded={r=>openRows.has(r.id)}
        renderExpanded={r=><GroupDetail row={r} onView={setPreview}/>}
        columns={[
        {label:"Time",render:r=><><div>{relTime(r.occurred_at)}</div><GroupToggle row={r} open={openRows.has(r.id)} onToggle={()=>toggleRow(r.id)}/></>},
        {label:"User",render:r=><UserCell row={r}/>},
        {label:"Service",render:r=><ServiceCell row={r}/>},
        {label:"Source",render:r=><Badge text={(r.source||"").replace(/_/g," ")} color={sourceTone[r.source]||"#9ca3af"}/>},
        {label:"Pattern",render:r=><Mono>{groupPattern(r)}</Mono>},
        {label:"Severity",render:r=><SeverityBadge sev={worstSev(groupMembers(r))}/>},
        {label:"",render:r=>{const c=contentMember(r); return <ViewBtn has={!!c} onClick={()=>setPreview(c)}/>;},right:true},
      ]} rows={promptGroups} empty="No prompt events matching this filter." paginate={25}/>
    </div>}

    {section==="files"&&<div className="aihub_card">
      <SectionHeader title="File uploads" hint="High & critical severity only"/>
      <DataTable onRow={r=>{ if(r.has_content) setPreview(r); }} columns={[
        {label:"Time",render:r=>relTime(r.occurred_at)},
        {label:"User",render:r=><UserCell row={r}/>},
        {label:"Service",render:r=><ServiceCell row={r}/>},
        {label:"Filename",render:r=><Mono>{r.metadata?.filename||"—"}</Mono>},
        {label:"Class",render:r=><Tag text={r.file_class||"—"}/>},
        {label:"Severity",render:r=><SeverityBadge sev={r.severity||r.highest_severity}/>},
        {label:"",render:r=><ViewBtn has={r.has_content} onClick={()=>setPreview(r)} label="Open"/>,right:true},
      ]} rows={fileRows} empty="No file upload events matching this filter." paginate={25}/>
    </div>}

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
  const surfaceC={browser:"#0052e0",desktop:"#8b5cf6",cli:"#f59e0b",all:"#22c55e"};
  const filtered=q?rows.filter(r=>[r.host,r.vendor,r.product,r.category].join(" ").toLowerCase().includes(q.toLowerCase())):rows;

  return (<div>
    <SectionHeader title="AI Platforms" hint="Registry of known AI platforms used by the organization."/>
    <div className="aihub_stat_grid">
      <StatCard icon={<Server size={18}/>} label="Total" value={rows.length} color="#0052e0"/>
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

// apiFetch's throw-on-!ok contract, with the admin credential attached. For
// admin-gated routes whose caller only wants the JSON and treats any failure
// the same way — e.g. OverviewView's soft() tiles, which already degrade to a
// named warning. Views that must tell "no credential" apart from "server
// broke" should call adminFetch directly and check res.status themselves.
async function adminJson(path) {
  const r = await adminFetch(path);
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
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
        <div><div className="aihub_replay_meta_label">AI service</div><div><Badge text={meta.ai_service||"unknown"} color="#0052e0"/></div></div>
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
      <StatCard icon={<History size={18}/>} label="Sessions" value={totalSessions} color="#0052e0"/>
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
        {label:"AI service",render:r=><Badge text={r.ai_service||"unknown"} color="#0052e0"/>},
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

      {/* No Microsoft tenant connected.
          Two independent conditions used to render at once: this empty state fired
          on `oauthKeys.length === 0` while the results block below fired on
          `scan.status === "completed"`, so a tenant that had been disconnected
          after a scan showed "No Microsoft 365 tenant connected" directly above a
          full 376-finding report. Now the empty state only claims the screen when
          there is genuinely nothing to show; if a previous scan exists it is kept
          (it is real data and still useful) and labelled as historical instead. */}
      {oauthKeys.length === 0 && !scan && (
        <Empty icon={<Shield size={32} />} title="No Microsoft 365 tenant connected"
          msg="Connect your Microsoft tenant in Agent Governance → Setup to run the Copilot Readiness Assessment." />
      )}
      {oauthKeys.length === 0 && scan && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, padding: "9px 14px",
                      borderRadius: 8, background: "#fffbeb", border: "1px solid #fde68a", fontSize: 12.5, color: "#92400e" }}>
          <AlertTriangle size={14} />
          <span>
            <strong>No Microsoft 365 tenant is connected, so this assessment cannot be re-run.</strong>{" "}
            The results below are from the last completed scan{scan.completed_at ? ` (${relTime(scan.completed_at)})` : ""} and may be out of date.
            Reconnect the tenant in Agent Governance → Setup to refresh them.
          </span>
        </div>
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
              {/* A real count. This used to read "~N documents potentially
                  exposed", computed as findings×50 — a number nothing measured,
                  printed to four significant figures.
                  Scans stored before the rename lack highRiskFindings, so fall
                  back to critical+high, which those documents do carry. */}
              {scan.summary.totalFindings} finding{scan.summary.totalFindings !== 1 ? "s" : ""}
              {(() => {
                const hi = scan.summary.highRiskFindings ?? ((scan.summary.critical || 0) + (scan.summary.high || 0));
                return hi > 0 ? <> · {hi} high or critical</> : null;
              })()}
              {" "}· Scanned in {((scan.durationMs || 0) / 1000).toFixed(1)}s
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
            background:sel?"#0044cc14":"#fff",color:sel?"#0052e0":"#6b7280",borderColor:sel?"#0044cc30":"#e2e5ea"}}>{o}</button>;
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

      <div style={{background:"#f5f6f8",borderRadius:10,padding:14,marginBottom:14}}>
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
                style={{padding:"2px 8px",borderRadius:5,fontSize:10,border:"1px solid #e5e7eb",background:actionModel===m?"#0044cc14":"#fff",color:actionModel===m?"#0052e0":"#6b7280",cursor:"pointer"}}>{m}</button>
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
          style={{padding:"8px 20px",borderRadius:8,border:"none",background:"#0052e0",color:"#fff",cursor:"pointer",fontSize:13,fontWeight:600,opacity:saving||!name.trim()||!actionModel.trim()?0.5:1}}>{saving?"Saving...":isEdit?"Save Changes":"Create Rule"}</button>
      </div>
    </div>
  </div>);
}

function ModelRoutingView() {
  const [tab,setTab]=useState("rules");
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
  useEffect(()=>{ loadAll(); },[]);

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
    {id:"rules",label:`Rules (${rules.length})`},
    // {id:"endpoints",label:`Endpoints (${(endpoints||[]).length})`},  // hidden — proxy routing pivoted to browser extension approach
    {id:"log",label:"Routing Log",hidden:true},
  ];

  return (<div>
    <SectionHeader title="Intelligent Model Routing" hint="Automatically route AI requests to the optimal model based on cost, sensitivity, and complexity"/>

    {/* Stat Cards */}
    <div className="aihub_stat_grid">
      <StatCard icon={<Activity size={18}/>} label="Requests Routed" value={analytics?.total_routed||0} hint={`${analytics?.last_24h||0} in last 24h`} color="#0052e0"/>
      <StatCard icon={<Shield size={18}/>} label="Active Rules" value={activeRules} hint={`${rules.length} total`} color="#8b5cf6"/>
      <StatCard icon={<Server size={18}/>} label="Endpoints" value={analytics?.active_endpoints||0} color="#22c55e"/>
      <StatCard icon={<Activity size={18}/>} label="Last 7 Days" value={analytics?.last_7d||0} color="#f59e0b"/>
    </div>

    {/* Tabs */}
    <div style={{display:"flex",gap:2,marginBottom:16,borderBottom:"2px solid #eff1f3"}}>
      {tabs.map(t=><button key={t.id} onClick={()=>setTab(t.id)}
        style={{padding:"8px 18px",fontSize:13,fontWeight:tab===t.id?700:500,border:"none",borderBottom:tab===t.id?"2px solid #0044cc":"2px solid transparent",
          background:"none",color:t.hidden?(tab===t.id?"#0052e0":"transparent"):(tab===t.id?"#0052e0":"#6b7280"),cursor:"pointer",marginBottom:-2}}>{t.label}</button>)}
    </div>
    {tab==="overview"&&(<div>
      {analytics?.total_routed===0 ? (
        <div className="aihub_card" style={{textAlign:"center",padding:"40px 20px"}}>
          <Activity size={40} color="#d1d5db" style={{marginBottom:12}}/>
          <h4 style={{margin:"0 0 8px",color:"#374151"}}>No routing activity yet</h4>
          <p style={{color:"#9ca3af",fontSize:13,maxWidth:400,margin:"0 auto 16px"}}>
            Create routing rules to automatically swap expensive models for cheaper ones on simple tasks, route sensitive data to private endpoints, and set up failover.
          </p>
          <button onClick={()=>{setTab("rules");setShowRuleForm(true);}} style={{padding:"8px 20px",borderRadius:8,border:"none",background:"#0052e0",color:"#fff",cursor:"pointer",fontSize:13,fontWeight:600}}>
            <Plus size={14} style={{verticalAlign:"middle",marginRight:4}}/> Create First Rule
          </button>
        </div>
      ):(
        <div className="aihub_two_col">
          <div className="aihub_card">
            <h4 style={{margin:"0 0 12px",fontSize:14,fontWeight:700}}>Model Swaps</h4>
            {(analytics?.by_model||[]).length?<DataTable columns={[
              {label:"Original Model",render:r=><Mono>{r.from||"—"}</Mono>},
              {label:"Routed To",render:r=><Badge text={r.to||"—"} color="#0052e0"/>},
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
                  <div key={c.complexity} style={{flex:1,textAlign:"center",padding:12,borderRadius:8,background:"#f5f6f8"}}>
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
          style={{display:"flex",alignItems:"center",gap:6,padding:"8px 16px",borderRadius:8,border:"none",background:"#0052e0",color:"#fff",cursor:"pointer",fontSize:13,fontWeight:600}}>
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
          {label:"Route To",render:r=><Badge text={r.action?.model||"—"} color="#0052e0"/>},
          {label:"Status",render:r=><Badge text={r.enabled?"Active":"Disabled"} color={r.enabled?"#22c55e":"#9ca3af"}/>},
          {label:"Actions",render:r=><div style={{display:"flex",gap:6}}>
            <button onClick={()=>{setEditRule(r);setShowRuleForm(true);}} style={{background:"none",border:"none",cursor:"pointer",color:"#0052e0",fontSize:12,fontWeight:600}}>Edit</button>
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
          style={{display:"flex",alignItems:"center",gap:6,padding:"8px 16px",borderRadius:8,border:"none",background:"#0052e0",color:"#fff",cursor:"pointer",fontSize:13,fontWeight:600}}>
          <Plus size={14}/> Add Endpoint
        </button>
      </div>

      {showEpForm&&(
        <div className="aihub_card" style={{marginBottom:16,background:"#f5f6f8"}}>
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
                style={{padding:"8px 20px",borderRadius:8,border:"none",background:"#0052e0",color:"#fff",cursor:"pointer",fontSize:13,fontWeight:600,opacity:!epName.trim()?0.5:1}}>Save</button>
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
          {label:"Routed To",render:r=><Badge text={r.routed_model||"—"} color="#0052e0"/>},
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

// "not_assessed" renders as grey, with no number and no dot — deliberately not
// green. A missing score is not a good score, and this badge used to print
// "null — Unknown" in the same shape as a passing grade.
function RiskLevelBadge({ level, score }) {
  if (score == null || level === "not_assessed" || !level) {
    return <span title="No risk assessment has run for this subject yet"
                 style={{display:"inline-flex",alignItems:"center",gap:6,padding:"3px 10px",borderRadius:8,
                         fontSize:12,fontWeight:600,background:"#f3f4f6",color:"#6b7280",border:"1px dashed #d1d5db"}}>
      Not assessed
    </span>;
  }
  const c = RISK_COLORS[level] || "#6b7280";
  return <span style={{display:"inline-flex",alignItems:"center",gap:6,padding:"3px 10px",borderRadius:8,fontSize:12,fontWeight:700,background:c+"14",color:c,border:"1px solid "+c+"30"}}>
    <span style={{width:8,height:8,borderRadius:"50%",background:c,display:"inline-block"}}/> {score} — {(level||"unknown").charAt(0).toUpperCase()+(level||"").slice(1)}
  </span>;
}

function ScoreBar({ score }) {
  // An unscored subject gets an empty track, not a zero-width green bar — the
  // latter is visually indistinguishable from "scored 0", i.e. perfectly safe.
  if (score == null || !Number.isFinite(Number(score))) {
    return <div title="Not assessed" style={{width:"100%",height:8,background:"#f3f4f6",borderRadius:4,
                 border:"1px dashed #d1d5db",boxSizing:"border-box"}}/>;
  }
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
  const [selected,setSelected]=useState(null);      // id of the open row, or null
  const [details,setDetails]=useState({});          // profileId → detail, cached
  const [loadingId,setLoadingId]=useState(null);

  const loadAll=()=>{
    Promise.all([
      apiFetch("/risk-scores"),
      apiFetch("/risk-scores/summary"),
    ]).then(([s,sum])=>{ setScores(s); setSummary(sum); })
      .catch(x=>setErr(x.message));
  };
  useEffect(()=>{ loadAll(); },[]);

  const compute=async()=>{
    setComputing(true);
    try {
      // First resolve profiles, then compute scores
      await fetch(IDENTITY_API+"/resolve",{method:"POST"});
      await fetch(RISK_API+"/compute",{method:"POST"});
      // Drop the cached breakdowns — recomputing changes exactly the numbers they
      // show, so keeping them would leave an expanded row displaying the previous
      // run's factors beside a freshly updated score in the same table.
      setDetails({}); setSelected(null);
      loadAll();
    } catch(e) { setErr(e.message); }
    setComputing(false);
  };

  /**
   * Open or close one employee's breakdown.
   *
   * The detail (score history + recent events) is fetched on first open and then
   * cached, so re-opening a row is instant and browsing the list does not refetch
   * the same profile repeatedly.
   *
   * A failure here sets the per-row detail to null rather than the page-level
   * error: one profile that will not load should not blank the whole table and
   * lose the other employees' scores.
   */
  const toggleRow=async(profileId)=>{
    if(selected===profileId){ setSelected(null); return; }
    setSelected(profileId);
    if(details[profileId]) return;                 // already cached
    setLoadingId(profileId);
    try {
      const r=await fetch(RISK_API+"/"+profileId);
      if(!r.ok) throw new Error(""+r.status);
      const json=await r.json();               // resolve BEFORE the state updater —
      setDetails(d=>({...d,[profileId]:json})); // that callback is not async

    } catch { setDetails(d=>({...d,[profileId]:null})); }
    finally { setLoadingId(null); }
  };

  if(err) return <Err msg={err}/>;
  if(!scores) return <Loading/>;

  // Filter out browser-extension noise (no real identity)
  // Only show employees with real identity — hide unidentified browser extension installs
  const realScores = scores.filter(s => s.display_name && !s.display_name.startsWith('Browser User'));

  return (<div>
    <SectionHeader title="AI Risk Scores" hint="Per-employee AI safety score — 0 (safe) to 100 (critical)"
      action={<button onClick={compute} disabled={computing} style={{display:"flex",alignItems:"center",gap:6,padding:"8px 16px",borderRadius:8,border:"none",background:"#0052e0",color:"#fff",cursor:"pointer",fontSize:13,fontWeight:600,opacity:computing?0.5:1}}>
        <RefreshCw size={14} className={computing?"aihub_spin":""}/> {computing?"Computing...":"Compute Scores"}
      </button>}
    />

    {/* Summary Cards */}
    {summary && <div className="aihub_stat_grid">
      <StatCard icon={<Shield size={18}/>} label="Average Score" value={summary.average_score} hint={summary.average_score<=30?"Low Risk":summary.average_score<=60?"Medium":"High"} color={summary.average_score<=30?"#22c55e":summary.average_score<=60?"#f59e0b":"#ef4444"}/>
      <StatCard icon={<Activity size={18}/>} label="Total Employees" value={summary.total_employees} color="#0052e0"/>
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
      <div className="aihub_card">
        <h4 style={{margin:"0 0 12px",fontSize:14,fontWeight:700}}>Employees by Risk</h4>
        <DataTable
          columns={[
            {label:"Employee",render:r=><div style={{display:"flex",alignItems:"center",gap:8}}>
              <ChevronRight size={13} style={{color:"#9ca3af",flexShrink:0,transition:"transform .15s",transform:selected===r.id?"rotate(90deg)":"none"}}/>
              <div>
                <div className="aihub_text_primary">{r.display_name}</div>
                <div className="aihub_text_muted">{r.email||r.hostname||"—"}</div>
              </div>
            </div>},
            {label:"Score",render:r=><RiskLevelBadge level={r.risk_level} score={r.risk_score}/>},
            {label:"",render:r=><div style={{minWidth:120}}><ScoreBar score={r.risk_score}/></div>},
            {label:"Sources",render:r=><div style={{display:"flex",gap:3,flexWrap:"wrap"}}>{(r.sources||[]).map(s=><Tag key={s} text={s}/>)}</div>},
            {label:"Computed",render:r=>relTime(r.risk_computed_at)},
          ]}
          rows={realScores}
          onRow={r=>toggleRow(r.id)}
          isExpanded={r=>selected===r.id}
          renderExpanded={r=><RiskRowDetail detail={details[r.id]} loading={loadingId===r.id}/>}
        />
      </div>
    )}
  </div>);
}

/**
 * Per-employee risk breakdown, expanded under their row.
 *
 * Fetched lazily — /risk-scores/:id returns score history and recent events, which
 * is far more than a list needs, so it is pulled only when someone actually opens
 * a row rather than for all employees up front.
 */
function RiskRowDetail({ detail, loading }) {
  if (loading) return <div style={{padding:"18px 20px"}}><Loading/></div>;
  if (!detail) return <div style={{padding:"18px 20px"}} className="aihub_text_muted">Could not load this breakdown.</div>;

  const H=({children})=><div style={{fontSize:11,fontWeight:700,color:"#6b7280",textTransform:"uppercase",letterSpacing:".03em",marginBottom:8}}>{children}</div>;
  const f=detail.profile?.risk_factors||{};
  // Every factor the scorer computes, so a zero reads as "measured, nothing found"
  // rather than the row being silently absent.
  const factors=[
    ["DLP Violations",     f.dlp_violations],
    ["Override Bypasses",  f.enforcement_overrides],
    ["Shadow AI Tools",    f.shadow_tools],
    ["Data Sensitivity",   f.data_sensitivity],
    ["Volume Anomaly",     f.volume_anomaly],
  ];

  return (<div style={{padding:"16px 20px",borderTop:"1px solid #e5e7eb"}}>
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(300px,1fr))",gap:22}}>

      <div>
        <H>Risk factors</H>
        {factors.map(([label,factor])=><FactorRow key={label} label={label} factor={factor}/>)}
        <div className="aihub_text_muted" style={{fontSize:11,marginTop:8}}>
          Each factor is capped at its own weight, so the total is a weighted blend rather than a sum.
        </div>
      </div>

      <div>
        {detail.history?.length>0 && <div style={{marginBottom:18}}>
          <H>Score history</H>
          <div style={{display:"flex",gap:3,alignItems:"flex-end",height:56}}>
            {detail.history.slice(0,30).reverse().map((h,i)=>{
              const c=h.score<=30?"#22c55e":h.score<=60?"#f59e0b":"#ef4444";
              return <div key={i} title={`${h.score} — ${new Date(h.computed_at).toLocaleDateString()}`}
                          style={{flex:1,minWidth:4,height:Math.max(h.score*0.55,2),background:c,borderRadius:2}}/>;
            })}
          </div>
          <div className="aihub_text_muted" style={{fontSize:11,marginTop:4}}>
            Oldest to newest, last {Math.min(detail.history.length,30)} computations.
          </div>
        </div>}

        {detail.recent_events?.length>0 && <div>
          <H>Recent events</H>
          <div style={{maxHeight:180,overflowY:"auto"}}>
            {detail.recent_events.slice(0,8).map((ev,i)=>(
              <div key={i} style={{padding:"6px 0",borderBottom:"1px solid #f3f4f6",fontSize:12}}>
                <div style={{display:"flex",justifyContent:"space-between",gap:8}}>
                  <span style={{fontWeight:600}}>{ev.event_kind||ev.kind||"—"}</span>
                  <span className="aihub_text_muted" style={{whiteSpace:"nowrap"}}>{relTime(ev.occurred_at)}</span>
                </div>
                <div className="aihub_text_muted">{ev.ai_service||"—"} · {ev.secret_class||ev.highest_severity||"—"}</div>
              </div>
            ))}
          </div>
        </div>}

        {!detail.history?.length && !detail.recent_events?.length &&
          <div className="aihub_text_muted" style={{fontSize:12}}>No score history or recent events recorded for this person yet.</div>}
      </div>

    </div>
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

// Where an inventory row came from. "Catalog" is the known-services list merged in
// from /ai-platforms — a service we know exists and can block, but which nothing in
// the org has been observed using; distinct from "Platform", which IS in the
// registry because it has real recorded activity.
// SOURCE_LABEL / SOURCE_TONE removed with the Source column. The expanded row
// detail prints row.source_detail || row.source verbatim rather than as a tag, so
// it needs neither map.

// Coarse Tool/Agent split, derived from the existing `category` field (there is
// no separate tool-vs-agent flag in the data — this groups the 12 categories
// registry.js already assigns). "agent-config", "autonomous-agent",
// "ide-assistant" and "mcp-server" all represent something that ACTS or
// integrates into a workflow on the user's behalf, rather than something the
// user directly chats with.
//
// KNOWN GRAY AREA: "desktop-app" covers both a plain chat client (e.g. the
// Claude desktop app) and an agentic IDE (e.g. Cursor) identically — discovery
// only sees "a running desktop process" either way, with nothing today
// distinguishing the two. Both land in "AI Tool" here. Splitting them further
// would need the scanner itself to tell them apart, not just this view.
const AGENT_CATEGORIES = new Set(['autonomous-agent', 'agent-config', 'ide-assistant', 'mcp-server']);
function systemTypeOf(category) {
  return AGENT_CATEGORIES.has(category) ? 'agent' : 'tool';
}

function RegistryStatusBadge({ status }) {
  const label = status === 'approved' ? 'Allowed' : status === 'blocked' ? 'Blocked' : 'Unreviewed';
  const c = STATUS_COLORS[status] || "#f59e0b";
  return <span style={{display:"inline-flex",alignItems:"center",gap:4,padding:"2px 10px",borderRadius:8,fontSize:11,fontWeight:700,background:c+"14",color:c,border:"1px solid "+c+"30"}}>{label}</span>;
}

function RegistryToggle({ status, onChange, pending }) {
  const isUnreviewed = status === 'unknown' || status === 'restricted';
  const isAllowed = status === 'approved';
  const isBlocked = status === 'blocked';

  // Shown next to the control while a decision is saving — the toggle's own
  // `status` doesn't flip until the reload after the write completes, so
  // without this the control looks unchanged and inert while a save is in
  // flight, which reads as "my click didn't register" and invites more clicks.
  const spinner = pending
    ? <RefreshCw size={13} className="aihub_spin" style={{color:"#6b7280"}}/>
    : null;

  if (isUnreviewed) {
    // First time — show both options side by side
    return (<div style={{display:"flex",alignItems:"center",gap:8}}>
      <button disabled={pending} onClick={()=>onChange('approved')} style={{padding:"6px 16px",borderRadius:8,fontSize:12,fontWeight:600,border:"1px solid #22c55e40",background:"#22c55e14",color:"#22c55e",cursor:pending?"default":"pointer",opacity:pending?0.6:1}}>Allow</button>
      <span style={{fontSize:11,color:"#f59e0b",fontWeight:600}}>Unreviewed</span>
      <button disabled={pending} onClick={()=>onChange('blocked')} style={{padding:"6px 16px",borderRadius:8,fontSize:12,fontWeight:600,border:"1px solid #ef444440",background:"#ef444414",color:"#ef4444",cursor:pending?"default":"pointer",opacity:pending?0.6:1}}>Block</button>
      {spinner}
    </div>);
  }

  // After first decision — simple toggle between allowed and blocked
  return (<div style={{display:"flex",alignItems:"center",gap:10}}>
    <span style={{fontSize:12,fontWeight:isAllowed?700:400,color:isAllowed?"#22c55e":"#9ca3af"}}>Allowed</span>
    <div onClick={()=>{ if(!pending) onChange(isAllowed?'blocked':'approved'); }}
      style={{width:44,height:24,borderRadius:12,background:isAllowed?"#22c55e":"#ef4444",cursor:pending?"default":"pointer",position:"relative",transition:"background 0.2s",opacity:pending?0.6:1}}>
      <div style={{width:18,height:18,borderRadius:9,background:"#fff",position:"absolute",top:3,left:isAllowed?3:23,transition:"left 0.2s",boxShadow:"0 1px 3px rgba(0,0,0,0.2)"}}/>
    </div>
    <span style={{fontSize:12,fontWeight:isBlocked?700:400,color:isBlocked?"#ef4444":"#9ca3af"}}>Blocked</span>
    {spinner}
  </div>);
}

// ═══════════════════════════════════════════════════════════════════════════════
// AI SYSTEMS — one table for the whole inventory, with risk detail in-row.
//
// This merges what used to be two sibling tabs, "AI Systems" and "Platforms".
// They were two views of one question ("what AI exists here?") split by which
// collection the row came from, so answering it meant reading both and joining
// them by eye:
//
//   /api/v1/registry      125 rows — discovered agents, endpoint-scanned tools,
//                         and the handful of platforms with real activity
//   /api/v1/ai-platforms   93 rows — the catalog of known AI hosts and the
//                         block/allow decision for each
//
// The registry deliberately includes a platform only when it has DLP activity or
// is explicitly blocked (registry.js "Source C"), so the other ~88 catalog entries
// were reachable ONLY from the Platforms tab — and the block control for a service
// lived on a different screen from the risk assessment of that same service.
//
// Now: one table, catalog rows merged in and deduped against the registry, and
// clicking any row expands the risk analysis and the allow/block control directly
// beneath it. A side detail panel loses its anchor as soon as the table scrolls;
// an inline expansion cannot.
// ═══════════════════════════════════════════════════════════════════════════════
function AIRegistryView() {
  const [sp]=useSearchParams();
  const [allItems,setAllItems]=useState(null);
  const [summary,setSummary]=useState(null);
  const [err,setErr]=useState(null);
  const [search,setSearch]=useState("");
  const [filterStatus,setFilterStatus]=useState("");
  const [filterType,setFilterType]=useState("");
  const [filterCategory,setFilterCategory]=useState("");
  const [filterRisk,setFilterRisk]=useState(sp.get("risk")||"");
  const [pendingIds,setPendingIds]=useState(()=>new Set());
  const [hideInactive,setHideInactive]=useState(!sp.get("showAll"));
  const [selected,setSelected]=useState(null);
  const [showAdd,setShowAdd]=useState(false);

  // Fetch ALL data once on mount — filter client-side for instant response.
  // Returns the promise chain (previously fire-and-forget) so a caller that
  // needs to know when the refreshed data has actually landed — e.g. clearing
  // a pending-decision spinner — can await it instead of just the write.
  const loadAll=()=>{
    return Promise.all([
      fetch(REGISTRY_API).then(r=>r.json()),
      fetch(`${REGISTRY_API}/summary`).then(r=>r.json()),
      fetch(`${API}/ai-platforms`).then(r=>r.json()).catch(()=>[]),
    ]).then(([reg,s,plats])=>{
      // Merge the platform catalog in, skipping anything the registry already
      // covers. Dedup on product name AND host: the registry keys platform rows by
      // host but names them by product, so matching on one alone double-lists a
      // service (e.g. "OpenAI API" appearing once per known OpenAI host).
      const seen=new Set();
      for(const r of reg){
        if(r.name) seen.add(String(r.name).toLowerCase());
        if(r.source_host) seen.add(String(r.source_host).toLowerCase());
      }
      const extra=[];
      for(const p of (Array.isArray(plats)?plats:[])){
        const nameKey=String(p.product||p.host||"").toLowerCase();
        if(!nameKey||seen.has(nameKey)||seen.has(String(p.host||"").toLowerCase())) continue;
        seen.add(nameKey);
        extra.push({
          // `plat:` prefix keeps these distinct from registry ids, and the row's
          // host is carried so the expansion can PATCH the right platform.
          id:"plat:"+p.host,
          name:p.product||p.host,
          vendor:p.vendor||null,
          platform:p.host,
          host:p.host,
          category:p.category||"ai-platform",
          status:p.blocked?"blocked":p.governed?"approved":"unknown",
          risk_score:null,        // never assessed — no activity to assess
          risk_level:null,
          risk_factors:[],
          owner:null,
          source:"platform_catalog",
          source_detail:p.surface||"browser",
          description:p.governance_note||null,
          first_seen:p.added_at||null,
          last_active:null,
          activity:{total:0,last_active:null},
          _catalogOnly:true,      // drives the "no usage recorded" note
        });
      }
      // Cross-reference registry statuses with fresh ai_platforms data.
      // The registry may return stale snapshot data where everything is "allowed",
      // but ai_platforms is always live. If a platform is blocked there, override
      // the registry row's status so the toggle shows the real state.
      const blockedHosts=new Set((Array.isArray(plats)?plats:[]).filter(p=>p.blocked).map(p=>p.host));
      const platByHost=new Map((Array.isArray(plats)?plats:[]).map(p=>[p.host,p]));
      for(const r of reg){
        // Match by matched_hosts, or by name/host substring
        const hosts=r.matched_hosts||[];
        let isBlocked=hosts.some(h=>blockedHosts.has(h));
        if(!isBlocked && !hosts.length){
          // Try to find by host substring (e.g. "Claude" → claude.ai)
          const lower=(r.name||"").toLowerCase();
          for(const [h,p] of platByHost){
            if(h.includes(lower)&&p.blocked){isBlocked=true;break;}
          }
        }
        if(isBlocked && r.status!=='blocked') r.status='blocked';
        else if(!isBlocked && r.status==='blocked') r.status='approved';
      }
      setAllItems([...reg,...extra]); setSummary(s);
    }).catch(x=>setErr(x.message));
  };
  // Called inside the effect rather than passed as the effect.
  //
  // loadAll RETURNS the Promise.all chain above, and `useEffect(loadAll, [])`
  // handed that Promise to React as the cleanup function. React then invoked it on
  // unmount and threw "destroy is not a function", which crashed AIRegistryView —
  // the component unmounted itself whenever you navigated away from the tab. The
  // sibling loadAll effects in this file were written the same way and are fixed
  // too: none of them returns a value today, but the shape is one `return` away
  // from reintroducing the same crash.
  useEffect(()=>{ loadAll(); },[]);

  // Catalog rows are governed through /ai-platforms (keyed by host); registry rows
  // through /registry/:id/status. Same button, two backends.
  //
  // Marked pending for the FULL round trip — the write and the reload that
  // brings the confirmed status back — not just the write. Clearing it right
  // after the write would drop the spinner while the toggle still shows the
  // stale status for one more render, which looks exactly like the click was
  // dropped. try/finally so a failed request still clears it instead of
  // leaving the toggle stuck disabled.
  const setRowStatus=async(row,status)=>{
    setPendingIds(prev=>new Set(prev).add(row.id));
    try{
      if(row._catalogOnly){
        await fetch(`${API}/ai-platforms/${encodeURIComponent(row.host)}`,{
          method:"PATCH",headers:{"content-type":"application/json"},
          body:JSON.stringify({blocked:status==="blocked",governed:status==="approved"}),
        });
      } else {
        await fetch(`${REGISTRY_API}/${encodeURIComponent(row.id)}/status`,{
          method:"PUT",headers:{"Content-Type":"application/json"},
          body:JSON.stringify({status,product_name:row.name,matched_hosts:row.matched_hosts||[]}),
        });
      }
      // Update local state immediately — don't reload from registry (it's slow
      // and may return stale snapshot data, reverting the toggle visually).
      setAllItems(prev=>(prev||[]).map(r=>r.id===row.id?{...r,status}:r));
    } finally {
      setPendingIds(prev=>{ const next=new Set(prev); next.delete(row.id); return next; });
    }
  };

  const updateStatus=async(id,status,productName,matchedHosts)=>{
    await fetch(`${REGISTRY_API}/${encodeURIComponent(id)}/status`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({status,product_name:productName,matched_hosts:matchedHosts||[]})});
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
    if(filterType && systemTypeOf(r.category)!==filterType) return false;
    if(filterCategory && r.category!==filterCategory) return false;
    if(filterRisk) { if(filterRisk==="not_assessed"?!!r.risk_level:(r.risk_level!==filterRisk)) return false; }
    if(q && !(r.name||'').toLowerCase().includes(q) && !(r.vendor||'').toLowerCase().includes(q) && !(r.owner||'').toLowerCase().includes(q) && !(r.platform||'').toLowerCase().includes(q) && !(r.category||'').toLowerCase().includes(q)) return false;
    return true;
  }).sort((a,b)=>(b.activity?.total||0)-(a.activity?.total||0));

  const categories=[...new Set(allItems.map(i=>i.category).filter(Boolean))].sort();
  // No lookup needed any more — the expansion renders from the row object the
  // table already holds, so `selected` is just the open row's id.

  return (<div>
    <SectionHeader
      title="AI & Agent Registry"
      hint="Every AI system across your organization — discovered agents, endpoint-scanned tools, and the known-services catalog."
      action={<button className="aihub_action_btn" onClick={()=>setShowAdd(v=>!v)}>
        {showAdd ? <><X size={13}/> Cancel</> : <><Plus size={13}/> Add AI platform</>}
      </button>}
    />

    {showAdd && <AddPlatformForm onDone={()=>{setShowAdd(false);loadAll();}}/>}

    {/* Summary Cards — count from visible pool (respects hide-inactive toggle) */}
    {(()=>{
      const pool=hideInactive?allItems.filter(r=>(r.activity?.total||0)>0):allItems;
      return <div className="aihub_stat_grid" style={{gridTemplateColumns:"repeat(4, 1fr)"}}>
        <StatCard icon={<Monitor size={18}/>} label="AI Systems" value={pool.length} hint={hideInactive?`+${inactiveCount} inactive`:`${activeCount} active`} color="#0052e0" onClick={()=>setHideInactive(!hideInactive)}/>
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
      <select value={filterType} onChange={e=>setFilterType(e.target.value)} style={{padding:"6px 10px",border:"1px solid #e5e7eb",borderRadius:8,fontSize:12,fontWeight:600}}>
        <option value="">All</option>
        <option value="tool">AI Tools</option>
        <option value="agent">AI Agents</option>
      </select>
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
        <option value="not_assessed">Not yet assessed</option>
      </select>
      {/* "Show unused" checkbox and the results count both removed. The AI Systems
          stat card above still toggles hideInactive and shows the row count, so this
          row is filters only. */}
    </div>

    {/* One table. Click a row to expand its risk analysis and controls in place. */}
    <div className="aihub_card" style={{overflow:"auto"}}>
      <DataTable
        columns={[
          {label:"AI System",render:r=><div style={{display:"flex",alignItems:"center",gap:8}}>
            <ChevronRight size={13} style={{color:"#9ca3af",flexShrink:0,transition:"transform .15s",transform:selected===r.id?"rotate(90deg)":"none"}}/>
            <div>
              <div className="aihub_text_primary">{r.name}</div>
              <div className="aihub_text_muted">{r.vendor||""}{r.platform?" · "+r.platform:""}</div>
            </div>
          </div>},
          {label:"Status",render:r=><RegistryStatusBadge status={r.status}/>},
          {label:"Risk",render:r=><span style={{whiteSpace:"nowrap"}}><RiskLevelBadge level={r.risk_level} score={r.risk_score}/></span>},
          {label:"Owner",render:r=><div style={{whiteSpace:"nowrap"}}>
            <div style={{fontSize:12}}>{r.owner||"—"}</div>
            {r.is_orphaned&&<span style={{fontSize:10,color:"#ef4444",fontWeight:600}}>⚠ Orphaned</span>}
          </div>},
          {label:"Activity",render:r=><div style={{textAlign:"right",whiteSpace:"nowrap"}}>
            <div style={{fontSize:13,fontWeight:600}}>{r.activity?.total?.toLocaleString()||0}</div>
            <div className="aihub_text_muted">{r.activity?.last_active?relTime(r.activity.last_active):"never"}</div>
          </div>,right:true},
        ]}
        rows={items}
        onRow={r=>setSelected(selected===r.id?null:r.id)}
        isExpanded={r=>selected===r.id}
        renderExpanded={r=><RegistryRowDetail row={r} onStatus={s=>setRowStatus(r,s)} pending={pendingIds.has(r.id)}/>}
        empty="No AI systems found matching your filters."
        paginate={25}
      />
    </div>
  </div>);
}

/**
 * Add an AI platform by URL, so the endpoints start governing it.
 *
 * One host covers everything under it. content.js matches a tab with
 * `h === ph || h.endsWith('.' + ph)`, so adding `example.com` governs
 * `chat.example.com`, `api.example.com` and every other subdomain — you do not
 * enumerate each agent, you claim the domain once.
 *
 * How it reaches the endpoints:
 *   POST /api/v1/ai-platforms      upserts the row (host is the key)
 *   extension: refreshPlatforms()  polls GET /ai-platforms?surface=browser
 *   OS monitor: policy-sync        polls the pack config on its own cycle
 *
 * Both poll on a timer, so a new platform takes effect within a few minutes on
 * every enrolled endpoint without anyone reinstalling anything. That delay is
 * stated in the UI rather than implied — an admin who blocks a tool and sees it
 * still working for two minutes should know that is expected, not broken.
 *
 * `capture_mode: "observe"` is the server default and this form keeps it: a newly
 * added platform starts by recording activity, not blocking it. Blocking is a
 * separate, deliberate click on the row afterwards, so adding a domain to the
 * inventory can never accidentally cut off a tool the business depends on.
 */
function AddPlatformForm({ onDone }) {
  // Category and governance_note are deliberately NOT collected here. Neither
  // affects governance — nothing in the extension, service worker or agent branches
  // on category, and governance_note is a display-only caveat — so asking for them
  // at add time was two decisions that changed nothing. Both are optional on the
  // POST (they default to null) and can be set later via PATCH if ever needed.
  const [host,setHost]=useState("");
  const [product,setProduct]=useState("");
  const [vendor,setVendor]=useState("");
  const [busy,setBusy]=useState(false);
  const [err,setErr]=useState(null);
  const [ok,setOk]=useState(null);

  // Mirrors normalizeHost() on the server: strip scheme, path and port so an admin
  // can paste a full URL out of the address bar and get the host we actually match.
  const cleanHost=(v)=>String(v||"").trim().toLowerCase().replace(/^https?:\/\//,"").split("/")[0].split(":")[0];
  const normalized=cleanHost(host);
  const valid=/^[a-z0-9.-]+\.[a-z0-9]{2,}$/.test(normalized);

  const submit=async()=>{
    setBusy(true); setErr(null); setOk(null);
    try {
      const res=await fetch(`${API}/ai-platforms`,{
        method:"POST",headers:{"content-type":"application/json"},
        body:JSON.stringify({
          host:normalized,
          product:product.trim()||normalized,
          vendor:vendor.trim()||null,
          surface:"browser",
          governed:1,
          added_by:"admin",
        }),
      });
      const body=await res.json().catch(()=>({}));
      if(!res.ok) throw new Error(body.error||`Request failed (${res.status})`);
      setOk(`${normalized} added — endpoints will pick it up on their next sync.`);
      setHost(""); setProduct(""); setVendor("");
      onDone?.();
    } catch(e){ setErr(e.message); }
    finally { setBusy(false); }
  };

  const field={padding:"7px 11px",fontSize:12.5,border:"1px solid #e5e7eb",borderRadius:6,fontFamily:"inherit",width:"100%",boxSizing:"border-box"};
  const lbl={fontSize:11,fontWeight:700,color:"#6b7280",textTransform:"uppercase",letterSpacing:".03em",marginBottom:4,display:"block"};

  return (<div className="aihub_card" style={{marginBottom:16,borderLeft:"3px solid #0044cc"}}>
    <SectionHeader title="Add an AI platform" hint="Enter the domain. Everything under it — every subdomain and every agent hosted there — is governed by this one entry."/>

    {err && <div className="aihub_error" style={{marginBottom:12}}><AlertTriangle size={14}/> {err}</div>}
    {ok && <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12,padding:"8px 12px",borderRadius:6,
                        background:"#f0fdf4",border:"1px solid #bbf7d0",fontSize:12,color:"#166534"}}>
      <Shield size={13}/> {ok}
    </div>}

    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(200px,1fr))",gap:12,marginBottom:12}}>
      <div>
        <label style={lbl}>Domain or URL *</label>
        <input style={field} placeholder="lovable.dev  or  https://chat.acme.ai/x"
               value={host} onChange={e=>setHost(e.target.value)}
               onKeyDown={e=>{ if(e.key==="Enter"&&valid&&!busy) submit(); }}/>
        {host && !valid && <div style={{fontSize:11,color:"#b91c1c",marginTop:4}}>Not a valid domain.</div>}
        {host && valid && normalized!==host.trim().toLowerCase() &&
          <div style={{fontSize:11,color:"#6b7280",marginTop:4}}>Will be saved as <Mono>{normalized}</Mono></div>}
      </div>
      <div>
        <label style={lbl}>Display name</label>
        <input style={field} placeholder={normalized||"Lovable"} value={product} onChange={e=>setProduct(e.target.value)}/>
      </div>
      <div>
        <label style={lbl}>Vendor</label>
        <input style={field} placeholder="Optional" value={vendor} onChange={e=>setVendor(e.target.value)}/>
      </div>
    </div>

    <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
      <button className="aihub_action_btn" disabled={!valid||busy} onClick={submit}>
        {busy?"Adding…":"Add platform"}
      </button>
      <span className="aihub_text_muted" style={{fontSize:11.5}}>
        Starts in <strong>observe</strong> mode — usage is recorded, nothing is blocked.
        Block it afterwards from its row. Endpoints sync within a few minutes.
      </span>
    </div>
  </div>);
}

/**
 * The expanded body of one inventory row: what it is, how risky, and the one
 * decision a reviewer is here to make (allow / block).
 *
 * Ordered by what the reviewer needs — the control first, then the evidence behind
 * it. A catalog row that has never been used says so plainly rather than showing an
 * empty "Risk analysis" heading: absence of activity is not absence of risk, and a
 * blank section reads as a clean bill of health.
 */
function RegistryRowDetail({ row, onStatus, pending }) {
  const cell=(label,value)=>value?<div><span style={{color:"#9ca3af"}}>{label}:</span> <span style={{fontWeight:600}}>{value}</span></div>:null;
  const H=({children})=><div style={{fontSize:11,fontWeight:700,color:"#6b7280",textTransform:"uppercase",letterSpacing:".03em",marginBottom:6}}>{children}</div>;
  return (<div style={{padding:"16px 20px",borderTop:"1px solid #e5e7eb"}}>
    {row.description&&<div style={{fontSize:12,color:"#374151",marginBottom:12}}>{row.description}</div>}

    <div style={{marginBottom:14}}>
      <H>Decision</H>
      <RegistryToggle status={row.status} onChange={onStatus} pending={pending}/>
    </div>

    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(190px,1fr))",gap:8,marginBottom:14,fontSize:12}}>
      {cell("Category",row.category)}
      {cell("Lifecycle",row.lifecycle)}
      {cell("Owner",row.owner)}
      {cell("Owner email",row.owner_email)}
      {cell("Model",row.model)}
      {cell("Source",row.source_detail||row.source)}
      {cell("First seen",row.first_seen?relTime(row.first_seen):null)}
      {cell("Last active",row.last_active?relTime(row.last_active):null)}
      {cell("Machines",row.machine_count)}
      {row.is_orphaned&&<div style={{gridColumn:"1/-1",color:"#ef4444",fontWeight:600}}>⚠ Owner account is disabled — this system is orphaned</div>}
    </div>

    {row.matched_hosts?.length>0&&<div style={{marginBottom:14}}>
      <H>Enforced hosts</H>
      <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
        {row.matched_hosts.map((h,i)=><span key={i} style={{fontSize:11,fontFamily:"monospace",padding:"2px 8px",borderRadius:5,background:row.status==='blocked'?"#fef2f2":"#f0fdf4",border:"1px solid "+(row.status==='blocked'?"#fca5a5":"#bbf7d0"),color:row.status==='blocked'?"#dc2626":"#16a34a"}}>{h}</span>)}
      </div>
      <div className="aihub_text_muted" style={{fontSize:10.5,marginTop:4}}>Blocking/allowing this system affects {row.matched_hosts.length===1?"this host":"all "+row.matched_hosts.length+" hosts"} in the extension.</div>
    </div>}

    <div style={{marginBottom:14}}>
      <H>Risk analysis</H>
      {row.risk_score!=null?(<>
        <RiskLevelBadge level={row.risk_level} score={row.risk_score}/>
        <div style={{marginTop:8,maxWidth:640}}><ScoreBar score={row.risk_score}/></div>
        {row.risk_factors?.length>0
          ? <ul style={{margin:"10px 0 0",paddingLeft:18,fontSize:11.5,color:"#4b5563"}}>
              {row.risk_factors.map((f,i)=><li key={i} style={{marginBottom:3}}>
                <strong>{f.signal||"Signal"}</strong>{f.weight?` (${f.weight})`:""}{f.description?` — ${f.description}`:""}
              </li>)}
            </ul>
          : <div className="aihub_text_muted" style={{fontSize:11.5,marginTop:8}}>Scored, but no individual signals were recorded for this system.</div>}
        {row.risk_basis==="platform_baseline"&&<div style={{fontSize:11,color:"#b45309",marginTop:8}}>
          Platform baseline — reflects the platform type, not an assessment of this specific system.
        </div>}
      </>):(
        <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
          <RiskLevelBadge level={null} score={null}/>
          <span className="aihub_text_muted" style={{fontSize:11.5}}>
            {row._catalogOnly
              ? "In the known-services catalog, but no usage has been captured — nothing to assess yet."
              : "No risk assessment has run for this system yet."}
          </span>
        </div>
      )}
    </div>

    {row.data_access?.length>0&&<div style={{marginBottom:14}}>
      <H>Data access</H>
      <div style={{display:"flex",flexWrap:"wrap",gap:4}}>{row.data_access.map((d,i)=><Tag key={i} text={d} color="#ef4444"/>)}</div>
    </div>}

    {row.permissions?.length>0&&<div style={{marginBottom:14}}>
      <H>Permissions</H>
      <div style={{maxHeight:110,overflowY:"auto",fontSize:11,color:"#6b7280"}}>
        {row.permissions.map((p,i)=><div key={i}>• {typeof p==='string'?p:p.scope||p.name||JSON.stringify(p)}</div>)}
      </div>
    </div>}

    <div>
      <H>Activity</H>
      <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
        <div style={{background:"#fff",border:"1px solid #e5e7eb",padding:"8px 16px",borderRadius:8,textAlign:"center",minWidth:110}}>
          <div style={{fontSize:17,fontWeight:700}}>{(row.activity?.total||0).toLocaleString()}</div>
          <div className="aihub_text_muted">Total events</div>
        </div>
        <div style={{background:"#fff",border:"1px solid #e5e7eb",padding:"8px 16px",borderRadius:8,textAlign:"center",minWidth:110}}>
          <div style={{fontSize:17,fontWeight:700}}>{row.activity?.unique_users||0}</div>
          <div className="aihub_text_muted">Users</div>
        </div>
      </div>
    </div>
  </div>);
}

// ── Access Requests View ──────────────────────────────────────────────────

// API-RELATIVE on purpose (no "/api/v1" prefix): every route below sits behind
// requireAdminAuth on the server — listing requests, approve, reject, and
// revoking an exception — so they all go through adminFetch, which prepends API
// itself. Bare fetch() here would send no credential and 401 on every call.
const ACCESS_API = "/access-requests";
const EXCEPTION_API = "/access-exceptions";

// WHERE a request came from. Both surfaces post to the same endpoint, so without
// this an admin cannot tell a desktop app block from a browser one — and the
// remedy differs (uninstall/allow-list an app vs. an extension rule).
// `surface` is optional: only the desktop agent stamps it, so every row that
// predates the desktop flow — and every browser row — arrives without it. Missing
// therefore means "browser", which is why the lookup below falls back to browser
// rather than rendering an "unknown" state that would only ever mean "old row".
const SURFACE_META = {
  desktop: { label:"Desktop", color:"#7c3aed", hint:"Requested from a desktop AI app, via the endpoint agent." },
  browser: { label:"Browser", color:"#0052e0", hint:"Requested from a web AI tool, via the browser extension." },
};
// Node's process.platform, spelled the way an admin reads it. Same raw values the
// Machines view tones by, so the two stay in step.
const SURFACE_PLATFORM_LABELS = { win32:"Windows", darwin:"macOS", linux:"Linux" };

// Render helpers rather than components on purpose: this file has no prop-types
// plumbing, and a `{ row }` component signature trips react/prop-types on every
// field it reads. Called as surfaceBadge(r), so nothing new goes red.
function surfaceBadge(row) {
  const meta = SURFACE_META[row?.surface] || SURFACE_META.browser;
  return <span title={meta.hint}><Badge text={meta.label} color={meta.color}/></span>;
}
// The desktop-only detail that makes the badge actionable: which app process asked,
// on which OS. Both fields are optional even on a desktop row, so this renders
// nothing rather than a half-empty line, and nothing at all for browser rows —
// they have no process to name.
function surfaceDetail(row) {
  if (row?.surface !== "desktop") return null;
  const parts = [row.process_name, SURFACE_PLATFORM_LABELS[row.platform] || row.platform].filter(Boolean);
  if (!parts.length) return null;
  return <div className="aihub_text_muted">{parts.join(" · ")}</div>;
}

// A denied write, phrased for the person who clicked the button. Same cause as
// the sdkAuthNotice panel below, but that panel only explains an empty list —
// an alert is what an admin needs when Approve does nothing.
const ACCESS_DENIED_MSG="Not authorised — approving, rejecting, and revoking need an admin credential (VITE_ADMIN_TOKEN in connect-ui/.env.local). Nothing was changed.";

function AccessRequestsView() {
  const [requests,setRequests]=useState(null);
  const [exceptions,setExceptions]=useState(null);
  const [err,setErr]=useState(null);
  const [authFail,setAuthFail]=useState(false); // 401/403 — a config gap, not an error
  const [tab,setTab]=useState("pending");
  const [approving,setApproving]=useState(null); // request id being approved
  const [expiryMode,setExpiryMode]=useState("hours"); // "hours" or "date"
  const [expiryHours,setExpiryHours]=useState("24");
  const [expiryDate,setExpiryDate]=useState("");
  const [reviewNote,setReviewNote]=useState("");

  // Same shape SdkProjectsView.load uses: 401/403 is its own state (setup
  // guidance), any other bad status is a real error. Rows are set to [] on an
  // auth failure so the view renders the notice instead of spinning forever.
  const loadAll=()=>{
    setErr(null);
    Promise.all([adminFetch(ACCESS_API),adminFetch(EXCEPTION_API)])
      .then(async([rr,er])=>{
        const denied=s=>s===401||s===403;
        if(denied(rr.status)||denied(er.status)){ setAuthFail(true); setRequests([]); setExceptions([]); return; }
        if(!rr.ok) throw new Error(`HTTP ${rr.status}`);
        if(!er.ok) throw new Error(`HTTP ${er.status}`);
        const [r,e]=[await rr.json(),await er.json()];
        setAuthFail(false);
        setRequests(Array.isArray(r)?r:[]); setExceptions(Array.isArray(e)?e:[]);
      })
      .catch(x=>{setErr(x.message); setRequests([]); setExceptions([]);});
  };
  useEffect(()=>{ loadAll(); },[]);

  const approve=async(id)=>{
    const body={note:reviewNote};
    if(expiryMode==="hours") body.expires_in_hours=Number(expiryHours);
    else body.expires_at=expiryDate;
    const res=await adminFetch(`${ACCESS_API}/${id}/approve`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
    if(res.status===401||res.status===403){setAuthFail(true);alert(ACCESS_DENIED_MSG);return;}
    if(!res.ok){const e=await res.json().catch(()=>({}));alert(e.error||"Failed");return;}
    setApproving(null);setReviewNote("");loadAll();
  };

  const reject=async(id)=>{
    const res=await adminFetch(`${ACCESS_API}/${id}/reject`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({note:reviewNote})});
    if(res.status===401||res.status===403){setAuthFail(true);alert(ACCESS_DENIED_MSG);return;}
    if(!res.ok){const e=await res.json().catch(()=>({}));alert(e.error||"Failed");return;}
    setApproving(null);setReviewNote("");loadAll();
  };

  const revoke=async(id)=>{
    if(!confirm("Revoke this access? The tool will be blocked again for this employee.")) return;
    const res=await adminFetch(`${EXCEPTION_API}/${id}`,{method:"DELETE"});
    if(res.status===401||res.status===403){setAuthFail(true);alert(ACCESS_DENIED_MSG);return;}
    if(!res.ok){alert(`Revoke failed (HTTP ${res.status}).`);return;}
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

    {/* Without a credential every count below is a truthful zero for a route
        that answered 401 — say so, rather than letting "0 pending" read as
        "nobody is waiting on you". Same panel the SDK views use. */}
    {authFail&&sdkAuthNotice("Reviewing tool access requests and active exceptions")}

    {/* Summary */}
    <div className="aihub_stat_grid" style={{gridTemplateColumns:"repeat(3, 1fr)"}}>
      <StatCard icon={<Clock size={18}/>} label="Pending" value={pending.length} hint="Awaiting your review" color="#f59e0b"/>
      <StatCard icon={<Shield size={18}/>} label="Active Exceptions" value={(exceptions||[]).length} hint="Temporary access granted" color="#22c55e"/>
      <StatCard icon={<Activity size={18}/>} label="Total Requests" value={requests.length} color="#0052e0"/>
    </div>

    {/* Tabs */}
    <div style={{display:"flex",gap:2,marginBottom:16,borderBottom:"2px solid #eff1f3"}}>
      {tabs.map(t=><button key={t.id} onClick={()=>setTab(t.id)}
        style={{padding:"10px 20px",fontSize:13,fontWeight:tab===t.id?700:500,border:"none",borderBottom:tab===t.id?"2px solid #0052e0":"2px solid transparent",
          background:tab===t.id?"none":"none",color:tab===t.id?"#0052e0":"#8b919e",cursor:"pointer",marginBottom:-2,fontFamily:"inherit",transition:"all 0.15s",letterSpacing:"-0.01em"}}>{t.label}</button>)}
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
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4,flexWrap:"wrap"}}>
                  <span style={{fontSize:16,fontWeight:700}}>{r.tool_name||r.tool_host}</span>
                  {r.tool_vendor&&<Tag text={r.tool_vendor}/>}
                  {surfaceBadge(r)}
                </div>
                {surfaceDetail(r)}
                {/* Name the device too, but only when it adds something: on a
                    machine with no detected user employee_name IS the hostname,
                    and repeating it reads like two different facts. */}
                <div className="aihub_text_muted" style={{marginBottom:6}}>
                  Requested by <strong>{r.employee_name}</strong>
                  {r.hostname&&r.hostname!==r.employee_name&&<> on {r.hostname}</>}
                  {" · "}{relTime(r.submitted_at)}
                </div>
                {r.reason&&<div style={{fontSize:13,color:"#374151",background:"#f5f6f8",padding:"8px 12px",borderRadius:8,marginBottom:8}}>"{r.reason}"</div>}
              </div>
            </div>

            {approving===r.id?(
              <div style={{background:"#f0f9ff",borderRadius:10,padding:14,marginTop:8}}>
                <div style={{fontSize:13,fontWeight:600,marginBottom:8}}>Set expiry (required)</div>
                <div style={{display:"flex",gap:8,marginBottom:10}}>
                  <button onClick={()=>setExpiryMode("hours")} style={{padding:"5px 12px",borderRadius:6,fontSize:12,border:"1px solid",cursor:"pointer",background:expiryMode==="hours"?"#0044cc14":"#fff",color:expiryMode==="hours"?"#0052e0":"#6b7280",borderColor:expiryMode==="hours"?"#0044cc40":"#e2e5ea"}}>Hours</button>
                  <button onClick={()=>setExpiryMode("date")} style={{padding:"5px 12px",borderRadius:6,fontSize:12,border:"1px solid",cursor:"pointer",background:expiryMode==="date"?"#0044cc14":"#fff",color:expiryMode==="date"?"#0052e0":"#6b7280",borderColor:expiryMode==="date"?"#0044cc40":"#e2e5ea"}}>Date</button>
                </div>
                {expiryMode==="hours"?(
                  <div style={{display:"flex",gap:6,alignItems:"center",marginBottom:10}}>
                    {["4","8","24","72","168"].map(h=>
                      <button key={h} onClick={()=>setExpiryHours(h)} style={{padding:"4px 10px",borderRadius:6,fontSize:11,border:"1px solid",cursor:"pointer",background:expiryHours===h?"#0044cc14":"#fff",color:expiryHours===h?"#0052e0":"#6b7280",borderColor:expiryHours===h?"#0044cc40":"#e2e5ea"}}>{h==="168"?"7 days":h+"h"}</button>
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
                <button onClick={()=>setApproving(r.id)} style={{padding:"6px 16px",borderRadius:8,border:"none",background:"#0052e0",color:"#fff",cursor:"pointer",fontSize:12,fontWeight:600,borderRadius:8}}>Review</button>
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
        {label:"Employee",render:r=><UserCell row={r}/>},
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
        {label:"Tool",render:r=><><div className="aihub_text_primary">{r.tool_name||r.tool_host}</div>
          <div style={{marginTop:3,display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>{surfaceBadge(r)}{surfaceDetail(r)}</div></>},
        {label:"Employee",render:r=><UserCell row={r}/>},
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
// SDK — credential projects, and the traces the connected apps report back
// ═══════════════════════════════════════════════════════════════════════════════
// Two tabs, one story. Projects mints the pk-lf-… / sk-lf-… pair a developer drops
// into their app; Traces shows what that app has reported since.
//
// AUTH SPLIT — mirrors the server exactly (server/src/routes/sdk.js and
// server/src/routes/tracing.js), it is not an inconsistency:
//   * /sdk/projects/*            → requireAdminAuth  → adminFetch
//   * /tracing/traces*           → open (masked previews + rollups only) → apiFetch
//   * /tracing/observations/:id/io → requireAdminAuth (raw prompt text) → adminFetch
// adminFetch only sends a bearer token when VITE_ADMIN_TOKEN is set, so a build
// with no token gets a 401 here. That is an expected local-dev state, so it is
// rendered as configuration guidance (sdkAuthNotice below) rather than an error.
//
// REPLACES the old hidden DeveloperSDKView, which could not have worked: it read
// api_key / selectedProject.api_key fields the server never returns, sent no
// Authorization header at five admin-gated routes, and its snippets POSTed to
// /api/v1/sdk/events after monkey-patching globalThis.fetch — passive interception,
// which is explicitly not the approach this project took. Nothing is carried over.

const SDK_LANGS = ["javascript", "typescript", "python", "java", "go", "other"];

// The SDK in a developer's app talks to the API server directly — it does not go
// through this dashboard's /api dev proxy. connect-ui is served on :3000 in both
// local dev and the docker deploy, while the API listens on :8787, so the port
// swap below is the correct answer in both. Anything else (same-origin reverse
// proxy) is already right as-is.
function serverOrigin() {
  const o=window.location.origin;
  return o.includes(":3000")?o.replace(":3000",":8787"):o;
}

// Left-border tone per observation type, in the same spirit as AUTONOMY_TONE.
// An unrecognised-but-plausible type (AGENT/TOOL/CHAIN/… or something newer)
// falls back to grey and renders as a generic span — never a crash, never a
// dropped row.
const OBS_TONE={GENERATION:"#0052e0",SPAN:"#8b5cf6",EVENT:"#f59e0b",AGENT:"#ef4444",TOOL:"#0891b2",CHAIN:"#6366f1",RETRIEVER:"#22c55e",EMBEDDING:"#14b8a6",GUARDRAIL:"#db2777"};
function obsTone(t) { return OBS_TONE[String(t||"").toUpperCase()]||"#9ca3af"; }

// `level` is DEFAULT / WARNING / ERROR (DEBUG exists server-side too). Mapped onto
// SeverityBadge's existing tones rather than inventing a second colour vocabulary.
function levelBadge(level) {
  const l=String(level||"").toUpperCase();
  if(l==="ERROR") return <SeverityBadge sev="critical"/>;
  if(l==="WARNING") return <SeverityBadge sev="medium"/>;
  return <span className="aihub_text_muted">—</span>;
}

function copyText(text) {
  const fallback=()=>{
    const ta=document.createElement("textarea");
    ta.value=text; ta.style.position="fixed"; ta.style.left="-9999px";
    document.body.appendChild(ta); ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
  };
  try{
    const p=navigator.clipboard?.writeText(text);
    if(p&&typeof p.catch==="function") p.catch(fallback); else if(!p) fallback();
  }catch{ fallback(); }
}

// Not an error state: a checkout with no VITE_ADMIN_TOKEN is the normal starting
// point, so this reads as setup instructions.
function sdkAuthNotice(what) {
  return (<div className="aihub_card" style={{borderLeft:"3px solid #f59e0b"}}>
    <div style={{display:"flex",gap:10,alignItems:"flex-start"}}>
      <Shield size={18} color="#f59e0b" style={{flexShrink:0,marginTop:2}}/>
      <div>
        <div style={{fontWeight:700,fontSize:14,marginBottom:4}}>Admin credential required</div>
        <p className="aihub_text_muted" style={{fontSize:12.5,lineHeight:1.65,margin:0}}>
          {what} is admin-only, and this build is not sending an admin token, so the server answered 401.
          Add a line to <Mono>connect-ui/.env.local</Mono> and restart the dev server:
        </p>
        <pre className="aihub_content_pre" style={{marginTop:10,fontSize:12}}>VITE_ADMIN_TOKEN=dev-admin-token</pre>
        <p className="aihub_text_muted" style={{fontSize:11.5,lineHeight:1.6,marginTop:8,marginBottom:0}}>
          <Mono>dev-admin-token</Mono> is the documented local default in <Mono>server/src/auth.js</Mono>.
          A deployed server sets its own <Mono>ADMIN_TOKEN</Mono>, and that value goes here instead.
          Nothing is hardcoded in the app — with no token set, no <Mono>Authorization</Mono> header is sent at all.
        </p>
      </div>
    </div>
  </div>);
}

// One numbered step of the "How a developer connects" checklist. There is no
// shared numbered-step component in this app (checked AgentGovernance and
// ConnectTenantModal), so this stays local to the SDK view instead of growing a
// new CSS file for a single panel. A plain JSX-returning function, same shape as
// sdkAuthNotice above, rather than a component — it needs no state and no
// prop-types. The <ol> keeps role="list" explicitly because listStyle:none drops
// list semantics in Safari/VoiceOver, and the number is real text so a screen
// reader still announces it.
function sdkStep(n, title, body) {
  return (<li style={{display:"flex",gap:12,alignItems:"flex-start"}}>
    <span style={{flexShrink:0,width:24,height:24,borderRadius:"50%",background:"#0052e0",color:"#fff",fontSize:12,fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center",marginTop:1}}>{n}</span>
    <div style={{minWidth:0,flex:1}}>
      <div style={{fontSize:12.5,fontWeight:700,color:"#374151",marginBottom:6}}>{title}</div>
      {body}
    </div>
  </li>);
}

// ── SDK → Projects ───────────────────────────────────────────────────────────
function SdkProjectsView() {
  const [rows,setRows]=useState(null);            // null = still loading
  const [authFail,setAuthFail]=useState(false);
  const [err,setErr]=useState(null);
  const [showForm,setShowForm]=useState(false);
  const [name,setName]=useState(""),[lang,setLang]=useState("javascript"),[desc,setDesc]=useState("");
  const [busy,setBusy]=useState(false),[formErr,setFormErr]=useState(null);
  // The ONLY place a raw secret_key ever lives. It arrives in the POST response,
  // is displayed once, and is dropped when the panel is dismissed. It is never
  // merged into `rows`, so no table render can reach it.
  const [reveal,setReveal]=useState(null);
  const [lastPk,setLastPk]=useState(null);        // public key only — safe to keep
  const [copied,setCopied]=useState(null);
  const [revoking,setRevoking]=useState(null);

  const load=useCallback(async()=>{
    setErr(null); setAuthFail(false);
    try{
      const res=await adminFetch("/sdk/projects");
      if(res.status===401||res.status===403){ setAuthFail(true); setRows([]); return; }
      if(!res.ok) throw new Error(`HTTP ${res.status}`);
      const list=await res.json();
      setRows(Array.isArray(list)?list:[]);
    }catch(x){ setErr(x.message); setRows([]); }
  },[]);
  useEffect(()=>{ load(); },[load]);

  const create=async(ev)=>{
    ev.preventDefault();
    if(!name.trim()) return;
    setBusy(true); setFormErr(null);
    try{
      const res=await adminFetch("/sdk/projects",{
        method:"POST",
        headers:{"content-type":"application/json"},
        body:JSON.stringify({name:name.trim(),language:lang,description:desc.trim()}),
      });
      if(res.status===401||res.status===403){ setAuthFail(true); setFormErr("Not authorised — see the note above about VITE_ADMIN_TOKEN."); setBusy(false); return; }
      if(!res.ok){ const b=await res.json().catch(()=>({})); setFormErr(b.error||`HTTP ${res.status}`); setBusy(false); return; }
      const p=await res.json();
      setReveal({id:p.id,name:p.name,public_key:p.public_key,secret_key:p.secret_key});
      setLastPk(p.public_key||null);
      setShowForm(false); setName(""); setDesc(""); setCopied(null);
      load();
    }catch(x){ setFormErr(x.message); }
    setBusy(false);
  };

  // Revoke, not delete — the server keeps the row with status:"revoked" so traces
  // already tagged to it stay attributable. Same confirm-then-DELETE shape
  // AccessRequestsView uses for its exceptions.
  const revoke=async(p)=>{
    if(!confirm(`Revoke "${p.name}"? Its keys stop working immediately and any app still using them will fail to report. Traces already recorded are kept.`)) return;
    setRevoking(p.id);
    try{
      const res=await adminFetch(`/sdk/projects/${encodeURIComponent(p.id)}`,{method:"DELETE"});
      if(!res.ok){ alert(`Revoke failed (HTTP ${res.status}).`); }
      else { if(reveal?.id===p.id) setReveal(null); await load(); }
    }catch(x){ alert(`Revoke failed: ${x.message}`); }
    setRevoking(null);
  };

  const copyBtn=(key,text)=>(
    <button type="button" onClick={()=>{copyText(text);setCopied(key);setTimeout(()=>setCopied(null),1500);}}
      title="Copy to clipboard"
      style={{display:"inline-flex",alignItems:"center",gap:5,padding:"4px 10px",borderRadius:6,fontSize:11,fontWeight:600,fontFamily:"inherit",cursor:"pointer",border:"1px solid #d1d5db",background:"#fff",color:copied===key?"#16a34a":"#374151"}}>
      {copied===key?<Check size={12}/>:<Copy size={12}/>}{copied===key?"Copied":"Copy"}
    </button>
  );

  const origin=serverOrigin();
  // While the one-time panel is open the snippet below carries the real secret —
  // same single reveal window. Once dismissed it drops back to a placeholder,
  // while the public key (not a credential on its own) stays for convenience.
  const pk=reveal?.public_key||lastPk||"<their public_key>";
  const sk=reveal?.secret_key||"<their secret_key — shown once at creation>";
  const envBlock=`CF_AIGOV_URL=${origin}\nCF_AIGOV_PUBLIC_KEY=${pk}\nCF_AIGOV_SECRET_KEY=${sk}`;
  // Where the unzipped folder is expected to sit, so the import path in step 4
  // resolves. Kept as one string so the tree and the import can't drift apart.
  const tree=`your-project/
├─ ai-gov-sdk/          ← the folder you just downloaded
│  ├─ src/index.js
│  └─ examples/demo.mjs
├─ your-app-code.js
└─ package.json`;
  // Relative import, not '@cloudfuze/ai-gov-sdk' — the package is not published,
  // so the developer hand-places the folder from step 2 and imports it by path.
  const snippet=`import { CloudFuzeTracer } from './ai-gov-sdk/src/index.js';
// ^ adjust the number of ../ if your code file isn't in your project's root

const tracer = new CloudFuzeTracer({
  baseUrl: process.env.CF_AIGOV_URL,
  publicKey: process.env.CF_AIGOV_PUBLIC_KEY,
  secretKey: process.env.CF_AIGOV_SECRET_KEY,
});

const trace = tracer.startTrace({ name: 'my-app', userId });
const gen = trace.startGeneration({ name: 'answer', model: 'gpt-4o', input });
gen.end({ output, usage: { input: 120, output: 45 } });
await tracer.flush();`;

  const live=(rows||[]).filter(p=>p.status!=="revoked");
  const totTraces=(rows||[]).reduce((t,p)=>t+(Number(p.total_traces)||0),0);
  const totCost=(rows||[]).reduce((t,p)=>t+(Number(p.total_cost_usd)||0),0);

  return (<div>
    <SectionHeader title="SDK Projects" hint="Credentials for apps that report their AI activity to this server."
      action={<button type="button" onClick={()=>{setShowForm(s=>!s);setFormErr(null);}}
        style={{display:"inline-flex",alignItems:"center",gap:6,padding:"7px 14px",borderRadius:8,border:"none",background:"#0052e0",color:"#fff",fontSize:12.5,fontWeight:600,fontFamily:"inherit",cursor:"pointer"}}>
        {showForm?<X size={14}/>:<Plus size={14}/>}{showForm?"Cancel":"New project"}
      </button>}/>

    {authFail&&sdkAuthNotice("Listing and creating SDK projects")}
    {err&&<Err msg={`Couldn't load SDK projects: ${err}`}/>}

    {/* ── One-time secret reveal ──────────────────────────────────────────────
        Rendered from `reveal` alone. Dismissing it is the only way to clear the
        secret from memory, so the wording has to make that consequence obvious. */}
    {reveal&&(<div className="aihub_card" style={{border:"1px solid #f59e0b",background:"#fffbeb"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:12}}>
        <div style={{display:"flex",gap:10,minWidth:0}}>
          <ShieldAlert size={20} color="#b45309" style={{flexShrink:0,marginTop:2}}/>
          <div style={{minWidth:0}}>
            <div style={{fontWeight:800,fontSize:14,color:"#92400e"}}>Copy the secret key now — it will never be shown again</div>
            <p style={{fontSize:12.5,color:"#92400e",lineHeight:1.6,margin:"4px 0 0"}}>
              The server stores only a hash of it. If it is lost, the only fix is to revoke
              <strong> {reveal.name} </strong> and create a new project.
            </p>
          </div>
        </div>
        <button type="button" onClick={()=>setReveal(null)} title="Dismiss — the secret is discarded"
          style={{border:"1px solid #d1d5db",background:"#fff",borderRadius:6,padding:"4px 10px",fontSize:11.5,fontWeight:600,fontFamily:"inherit",cursor:"pointer",flexShrink:0}}>
          I have saved it
        </button>
      </div>
      <div style={{marginTop:14}}>
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
          <span style={{fontSize:11,fontWeight:700,color:"#6b7280",textTransform:"uppercase",letterSpacing:.4}}>Public key</span>
          {copyBtn("pk",reveal.public_key||"")}
        </div>
        <pre className="aihub_content_pre" style={{fontSize:12,padding:12,margin:0}}>{reveal.public_key}</pre>
        <div style={{display:"flex",alignItems:"center",gap:8,margin:"12px 0 4px"}}>
          <span style={{fontSize:11,fontWeight:700,color:"#b45309",textTransform:"uppercase",letterSpacing:.4}}>Secret key — shown once</span>
          {copyBtn("sk",reveal.secret_key||"")}
        </div>
        <pre className="aihub_content_pre" style={{fontSize:12,padding:12,margin:0,borderColor:"#fbbf24",background:"#fffbeb"}}>{reveal.secret_key}</pre>
      </div>
    </div>)}

    {/* ── Create form ─────────────────────────────────────────────────────── */}
    {showForm&&(<form className="aihub_card" onSubmit={create}>
      <SectionHeader title="New SDK project" hint="One project per app. The secret key is generated here and shown exactly once."/>
      <div style={{display:"grid",gridTemplateColumns:"2fr 1fr",gap:12}}>
        <label style={{display:"block"}}>
          <span style={{fontSize:11.5,fontWeight:600,color:"#374151"}}>Name <span style={{color:"#ef4444"}}>*</span></span>
          <input value={name} onChange={e=>setName(e.target.value)} required placeholder="checkout-assistant"
            style={{width:"100%",marginTop:4,padding:"7px 10px",border:"1px solid #e5e7eb",borderRadius:8,fontSize:13,boxSizing:"border-box"}}/>
        </label>
        <label style={{display:"block"}}>
          <span style={{fontSize:11.5,fontWeight:600,color:"#374151"}}>Language</span>
          <select value={lang} onChange={e=>setLang(e.target.value)}
            style={{width:"100%",marginTop:4,padding:"7px 10px",border:"1px solid #e5e7eb",borderRadius:8,fontSize:13,boxSizing:"border-box",background:"#fff"}}>
            {SDK_LANGS.map(l=><option key={l} value={l}>{l}</option>)}
          </select>
        </label>
      </div>
      <label style={{display:"block",marginTop:12}}>
        <span style={{fontSize:11.5,fontWeight:600,color:"#374151"}}>Description</span>
        <input value={desc} onChange={e=>setDesc(e.target.value)} placeholder="What this app does (optional)"
          style={{width:"100%",marginTop:4,padding:"7px 10px",border:"1px solid #e5e7eb",borderRadius:8,fontSize:13,boxSizing:"border-box"}}/>
      </label>
      {formErr&&<div style={{marginTop:10}}><Err msg={formErr}/></div>}
      <div style={{display:"flex",gap:8,justifyContent:"flex-end",marginTop:14}}>
        <button type="button" onClick={()=>{setShowForm(false);setFormErr(null);}}
          style={{padding:"7px 16px",borderRadius:8,border:"1px solid #e5e7eb",background:"#fff",fontSize:12.5,fontFamily:"inherit",cursor:"pointer"}}>Cancel</button>
        <button type="submit" disabled={busy||!name.trim()}
          style={{padding:"7px 16px",borderRadius:8,border:"none",background:busy||!name.trim()?"#9ca3af":"#0052e0",color:"#fff",fontSize:12.5,fontWeight:600,fontFamily:"inherit",cursor:busy||!name.trim()?"default":"pointer"}}>
          {busy?"Creating…":"Create project"}
        </button>
      </div>
    </form>)}

    {rows===null&&!authFail&&!err&&<Loading/>}

    {rows!==null&&(<>
      {!authFail&&rows.length>0&&(<div className="aihub_stat_grid" style={{gridTemplateColumns:"repeat(3,1fr)"}}>
        <StatCard icon={<Server size={18}/>} label="Active projects" value={live.length} hint={`${rows.length-live.length} revoked`} color="#0052e0"/>
        <StatCard icon={<Activity size={18}/>} label="Traces reported" value={totTraces} hint="lifetime, all projects" color="#8b5cf6"/>
        <StatCard icon={<DollarSign size={18}/>} label="Reported cost" value={fmtUsd(totCost)} hint="as reported by the SDKs" color="#22c55e"/>
      </div>)}

      <div className="aihub_card">
        <DataTable columns={[
          {label:"Project",render:p=>(<><div className="aihub_text_primary">{p.name||"—"}</div>{p.description&&<div className="aihub_text_muted" style={{fontSize:11}}>{p.description}</div>}</>)},
          {label:"Public key",render:p=><Mono>{p.public_key||"—"}</Mono>},
          {label:"Language",render:p=>p.language?<Tag text={p.language}/>:<span className="aihub_text_muted">—</span>},
          {label:"Status",render:p=><Badge text={p.status||"unknown"} color={p.status==="active"?"#22c55e":p.status==="revoked"?"#ef4444":"#9ca3af"}/>},
          {label:"Created",render:p=>relTime(p.created_at)},
          {label:"Last report",render:p=>p.last_event_at?relTime(p.last_event_at):<span className="aihub_text_muted">never</span>},
          {label:"Traces",render:p=>(Number(p.total_traces)||0).toLocaleString(),right:true},
          {label:"Observations",render:p=>(Number(p.total_observations)||0).toLocaleString(),right:true},
          {label:"Cost",render:p=>fmtUsd(p.total_cost_usd),right:true},
          {label:"",render:p=>p.status==="active"
            ?<button type="button" onClick={()=>revoke(p)} disabled={revoking===p.id}
               style={{display:"inline-flex",alignItems:"center",gap:5,padding:"4px 12px",borderRadius:6,border:"1px solid #ef444440",background:"#ef444414",color:"#ef4444",fontSize:11,fontWeight:600,fontFamily:"inherit",cursor:revoking===p.id?"default":"pointer"}}>
               <Trash2 size={11}/>{revoking===p.id?"…":"Revoke"}</button>
            :<span className="aihub_text_muted">—</span>,right:true},
        ]} rows={rows} empty={authFail?"Can't list projects without an admin credential — see the note above.":"No SDK projects yet. Create one, hand the keys to a developer, and their app's activity shows up under the Traces tab."}/>
      </div>
    </>)}

    {/* ── How a developer connects ──────────────────────────────────────────
        A followable checklist, not a description: every step is something the
        developer does, in order, and steps 3–4 fill themselves in with the real
        keys the moment a project exists (placeholders before that). */}
    <div className="aihub_card">
      <SectionHeader title="How a developer connects" hint="Six steps, in order — hand them to whoever owns the app. Steps 3 and 4 fill in with the real keys as soon as you create a project."/>

      <ol role="list" style={{listStyle:"none",margin:"4px 0 0",padding:0,display:"flex",flexDirection:"column",gap:20}}>

        {sdkStep(1,"Download the SDK",<>
          {/* Root-relative on purpose: /api is proxied to the API server by the
              Vite dev server and by nginx in the deploy. Prefixing the app's
              /CloudFuze base path here would 404. No auth on this route, so a
              plain anchor is enough — same shape as the Teams manifest link. */}
          <a href={`${API}/sdk/download`} download="ai-gov-sdk.zip" className="aihub_dl_btn" style={{marginTop:0}}>
            <Download size={14}/>Download SDK (.zip)
          </a>
          <p className="aihub_text_muted" style={{fontSize:11.5,lineHeight:1.6,margin:"8px 0 0"}}>
            Not published to npm yet — that&apos;s why you&apos;re downloading a folder directly
            instead of running <Mono>npm install</Mono>.
          </p>
        </>)}

        {sdkStep(2,"Put the folder in your project",<>
          <p className="aihub_text_muted" style={{fontSize:12,lineHeight:1.65,margin:"0 0 8px"}}>
            Unzip the download. You&apos;ll get a folder called <Mono>ai-gov-sdk</Mono>. Move that whole
            folder into the root of your own project — the same folder that has your project&apos;s
            <Mono> package.json</Mono> (or main file) in it. For example:
          </p>
          <pre className="aihub_content_pre" style={{fontSize:12,padding:12,margin:0}}>{tree}</pre>
        </>)}

        {sdkStep(3,"Set these three values",<>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>{copyBtn("env",envBlock)}</div>
          <pre className="aihub_content_pre" style={{fontSize:12,padding:12,margin:0}}>{envBlock}</pre>
          {!reveal&&<p className="aihub_text_muted" style={{fontSize:11.5,lineHeight:1.6,margin:"8px 0 0"}}>
            The secret key is only ever visible in the panel shown at creation time. If it was not saved then,
            revoke the project and create a new one.
          </p>}
        </>)}

        {sdkStep(4,"Add the tracer to your code",<>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>{copyBtn("code",snippet)}</div>
          <pre className="aihub_content_pre" style={{fontSize:12,padding:12,margin:0}}>{snippet}</pre>
          <p className="aihub_text_muted" style={{fontSize:11.5,lineHeight:1.6,margin:"8px 0 0"}}>
            The import path matches the folder location in step 2. Nothing is intercepted and nothing is
            captured that the app does not pass in. Raw prompt and completion text is stored only for
            projects created with content capture on; otherwise the server keeps masked previews only.
          </p>
        </>)}

        {sdkStep(5,"Run it",
          <p className="aihub_text_muted" style={{fontSize:12,lineHeight:1.65,margin:0}}>
            Run your app the way you normally do. If you just want to test with our sample app instead of
            your own code, run the file at <Mono>ai-gov-sdk/examples/demo.mjs</Mono> the same way
            (<Mono>node ai-gov-sdk/examples/demo.mjs</Mono>) with the same 3 values set.
          </p>)}

        {sdkStep(6,"Confirm it worked",
          <p className="aihub_text_muted" style={{fontSize:12,lineHeight:1.65,margin:0}}>
            Come back here, click the <strong>Traces</strong> tab, and select this project — you should see
            a new trace appear within a few seconds.
          </p>)}

      </ol>
    </div>
  </div>);
}

// ── SDK → Traces ─────────────────────────────────────────────────────────────
function SdkTracesView() {
  const [params,setParams]=useSearchParams();
  const projectId=params.get("project_id")||"";
  const [projects,setProjects]=useState(null);   // null = loading
  const [projAuthFail,setProjAuthFail]=useState(false);
  const [manualId,setManualId]=useState(projectId);
  const [rows,setRows]=useState(null);
  const [err,setErr]=useState(null);
  // One expanded trace at a time — same single-detail shape DLPView uses for its
  // content preview, and it keeps the observation/IO state below unambiguous.
  const [openId,setOpenId]=useState(null);
  const [detail,setDetail]=useState(null);
  const [detailErr,setDetailErr]=useState(null);
  const [obsId,setObsId]=useState(null);
  const [io,setIo]=useState(null);               // {status,input,output,message}

  // The project id lives in the URL so a refresh (or a pasted link) keeps it.
  // Merge rather than replace: TabGroup keeps ?tab= in the same query string.
  const selectProject=(id)=>{
    const next=new URLSearchParams(params);
    if(id) next.set("project_id",id); else next.delete("project_id");
    setParams(next,{replace:true});
  };

  useEffect(()=>{
    let dead=false;
    (async()=>{
      try{
        const res=await adminFetch("/sdk/projects");
        if(res.status===401||res.status===403){ if(!dead){setProjAuthFail(true);setProjects([]);} return; }
        if(!res.ok) throw new Error(`HTTP ${res.status}`);
        const list=await res.json();
        if(!dead) setProjects(Array.isArray(list)?list:[]);
      }catch{ if(!dead){ setProjAuthFail(true); setProjects([]); } }
    })();
    return ()=>{dead=true};
  },[]);

  useEffect(()=>{
    setOpenId(null); setDetail(null); setDetailErr(null); setObsId(null); setIo(null);
    if(!projectId){ setRows(null); setErr(null); return; }
    let dead=false; setRows(null); setErr(null);
    apiFetch(`/tracing/traces?project_id=${encodeURIComponent(projectId)}&limit=50`)
      .then(d=>{ if(!dead) setRows(Array.isArray(d?.traces)?d.traces:[]); })
      .catch(x=>{ if(!dead) setErr(x.message); });
    return ()=>{dead=true};
  },[projectId]);

  const openTrace=async(r)=>{
    if(openId===r.id){ setOpenId(null); return; }
    setOpenId(r.id); setDetail(null); setDetailErr(null); setObsId(null); setIo(null);
    try{
      const d=await apiFetch(`/tracing/traces/${encodeURIComponent(r.id)}?project_id=${encodeURIComponent(projectId)}`);
      setDetail(d);
    }catch(x){
      setDetailErr(x.message==="404"
        ?"This trace is no longer available — it may have passed the project's retention window."
        :`Couldn't load this trace's steps (HTTP ${x.message}).`);
    }
  };

  const pickObs=(o)=>{
    setIo(null);
    setObsId(cur=>cur===o.id?null:o.id);
  };

  // Admin-gated raw content, fetched one observation at a time and only when a
  // human clicks. Every failure mode gets its own sentence — a blank box here
  // would read as "there is no content" when it can just as easily mean 401.
  const loadIo=async(o)=>{
    setIo({status:"loading"});
    try{
      const res=await adminFetch(`/tracing/observations/${encodeURIComponent(o.id)}/io?project_id=${encodeURIComponent(projectId)}`);
      if(res.status===401||res.status===403){ setIo({status:"error",message:"Admin credential required — set VITE_ADMIN_TOKEN in connect-ui/.env.local (local value: dev-admin-token) and restart the dev server."}); return; }
      if(res.status===404){ setIo({status:"error",message:"Content unavailable — this project doesn't store raw content, so only the masked previews above exist."}); return; }
      if(!res.ok){ setIo({status:"error",message:`Content unavailable (HTTP ${res.status}).`}); return; }
      const d=await res.json();
      setIo({status:"ok",input:d.input,output:d.output});
    }catch(x){ setIo({status:"error",message:`Content unavailable: ${x.message}`}); }
  };

  const selected=(projects||[]).find(p=>p.id===projectId);

  return (<div>
    <SectionHeader title="SDK Traces" hint="What the connected apps have reported. Pick a project, then click a trace to see its steps."/>

    {/* Project selector. With no admin token the project list itself is 401, so
        this degrades to a plain id box rather than becoming unusable. */}
    <div className="aihub_card">
      {projects===null?<Loading/>:projAuthFail?(<div>
        <div style={{fontSize:12.5,fontWeight:600,color:"#374151",marginBottom:6}}>Project ID</div>
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
          <input value={manualId} onChange={e=>setManualId(e.target.value)} placeholder="Paste a project id"
            style={{flex:"1 1 320px",padding:"7px 10px",border:"1px solid #e5e7eb",borderRadius:8,fontSize:13}}/>
          <button type="button" onClick={()=>selectProject(manualId.trim())}
            style={{padding:"7px 16px",borderRadius:8,border:"none",background:"#0052e0",color:"#fff",fontSize:12.5,fontWeight:600,fontFamily:"inherit",cursor:"pointer"}}>Load traces</button>
        </div>
        <p className="aihub_text_muted" style={{fontSize:11.5,lineHeight:1.6,margin:"8px 0 0"}}>
          The project drop-down needs an admin credential (<Mono>VITE_ADMIN_TOKEN</Mono> in <Mono>connect-ui/.env.local</Mono>,
          local value <Mono>dev-admin-token</Mono>). Reading traces does not — paste a project id and this view works on its own.
        </p>
      </div>):projects.length===0?(
        <Empty icon={<Server size={28} strokeWidth={1.5}/>} title="No SDK projects yet"
          msg="Create one on the Projects tab first — traces are always scoped to a project."/>
      ):(<div>
        <div style={{fontSize:12.5,fontWeight:600,color:"#374151",marginBottom:6}}>Project</div>
        <select value={projectId} onChange={e=>selectProject(e.target.value)}
          style={{minWidth:320,padding:"7px 10px",border:"1px solid #e5e7eb",borderRadius:8,fontSize:13,background:"#fff"}}>
          <option value="">Select a project…</option>
          {projects.map(p=><option key={p.id} value={p.id}>{p.name}{p.status==="revoked"?" (revoked)":""}</option>)}
        </select>
        {selected&&<span style={{marginLeft:10}}><Badge text={selected.status||"unknown"} color={selected.status==="active"?"#22c55e":"#ef4444"}/></span>}
        {selected&&selected.capture_content===false&&<span style={{marginLeft:6}}><Badge text="content masked" color="#6b7280"/></span>}
      </div>)}
    </div>

    {!projectId&&projects!==null&&(projAuthFail||projects.length>0)&&(
      <div className="aihub_card"><Empty icon={<Activity size={28} strokeWidth={1.5}/>} title="Pick a project"
        msg="Choose a project above to see the traces its app has reported."/></div>
    )}

    {projectId&&err&&<Err msg={`Couldn't load traces: ${err}`}/>}
    {projectId&&!err&&rows===null&&<Loading/>}

    {projectId&&rows!==null&&rows.length===0&&(
      <div className="aihub_card"><Empty icon={<Activity size={28} strokeWidth={1.5}/>} title="No traces yet"
        msg="Once a connected app sends data, it'll show up here. The Projects tab has the keys and the three setup steps."/></div>
    )}

    {projectId&&rows!==null&&rows.length>0&&(<div className="aihub_card">
      <SectionHeader title={`${rows.length} most recent trace${rows.length===1?"":"s"}`} hint="Click a row to open its waterfall."/>
      <DataTable
        onRow={openTrace}
        isExpanded={r=>r.id===openId}
        columns={[
          {label:"Trace",render:r=>(<><div className="aihub_text_primary">{r.name||"—"}</div><div className="aihub_text_muted" style={{fontSize:11}}>{r.environment||"default"}</div></>)},
          {label:"When",render:r=>relTime(r.timestamp)},
          {label:"User",render:r=>r.user_id?<Mono>{r.user_id}</Mono>:<span className="aihub_text_muted">—</span>},
          {label:"Steps",render:r=>`${Number(r.observation_count)||0} (${Number(r.generation_count)||0} gen)`,right:true},
          {label:"Tokens",render:r=>fmtTokens(r.total_tokens),right:true},
          {label:"Cost",render:r=><span>{fmtUsd(r.total_cost_usd)}{r.cost_estimated?<span className="aihub_text_muted" style={{fontSize:10}}> (est.)</span>:null}</span>,right:true},
          {label:"Latency",render:r=>r.latency_ms==null?"—":`${Math.round(r.latency_ms)}ms`,right:true},
          {label:"Level",render:r=>levelBadge(r.level)},
        ]}
        rows={rows}
        renderExpanded={r=>{
          if(r.id!==openId) return null;
          if(detailErr) return <div style={{padding:14}}><Err msg={detailErr}/></div>;
          if(!detail) return <div style={{padding:14}}><Loading/></div>;
          const obs=Array.isArray(detail.observations)?detail.observations:[];
          // Waterfall scale: the trace's own latency when it has one, otherwise
          // the furthest observation end, so a stub trace still draws.
          const span=Math.max(1,Number(detail.trace?.latency_ms)||0,
            ...obs.map(o=>(Number(o.offset_ms)||0)+(Number(o.latency_ms)||0)));
          const active=obs.find(o=>o.id===obsId)||null;
          return (<div style={{padding:"14px 16px"}}>
            {(r.input_preview||r.output_preview)&&(<div style={{marginBottom:12,display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
              <div><div style={{fontSize:10.5,fontWeight:700,color:"#6b7280",textTransform:"uppercase",letterSpacing:.4,marginBottom:3}}>Input preview</div>
                <div className="aihub_text_muted" style={{fontSize:12,lineHeight:1.5}}>{r.input_preview||"—"}</div></div>
              <div><div style={{fontSize:10.5,fontWeight:700,color:"#6b7280",textTransform:"uppercase",letterSpacing:.4,marginBottom:3}}>Output preview</div>
                <div className="aihub_text_muted" style={{fontSize:12,lineHeight:1.5}}>{r.output_preview||"—"}</div></div>
            </div>)}

            {obs.length===0
              ?<p className="aihub_text_muted" style={{fontSize:12.5,margin:0}}>This trace has no recorded steps — the app opened it but never reported a span or generation.</p>
              :(<div>
                <div style={{fontSize:11,fontWeight:700,color:"#6b7280",textTransform:"uppercase",letterSpacing:.4,marginBottom:6}}>
                  {obs.length} step{obs.length===1?"":"s"} · {Math.round(span)}ms total
                </div>
                {obs.map(o=>{
                  const off=Number(o.offset_ms)||0, dur=Number(o.latency_ms)||0;
                  const left=Math.min(99,(off/span)*100);
                  const width=Math.max(1,Math.min(100-left,(dur/span)*100));
                  const tone=obsTone(o.type);
                  const on=o.id===obsId;
                  return (<div key={o.id}>
                    <div role="button" tabIndex={0} onClick={()=>pickObs(o)}
                      onKeyDown={e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();pickObs(o);}}}
                      style={{display:"flex",alignItems:"center",gap:10,padding:"5px 8px",borderRadius:6,cursor:"pointer",
                        borderLeft:`3px solid ${tone}`,background:on?"#eef2ff":"transparent",marginLeft:(Number(o.depth)||0)*14}}>
                      <div style={{flex:"0 0 210px",minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",fontSize:12}}>
                        <span style={{fontWeight:600}}>{o.name||o.type||"step"}</span>
                        <span className="aihub_text_muted" style={{marginLeft:6,fontSize:10.5}}>{String(o.type||"SPAN").toLowerCase()}</span>
                      </div>
                      <div style={{flex:1,position:"relative",height:10,background:"#f3f4f6",borderRadius:5,minWidth:80}}>
                        <div title={`${Math.round(off)}ms → ${Math.round(off+dur)}ms`}
                          style={{position:"absolute",left:`${left}%`,width:`${width}%`,top:0,bottom:0,borderRadius:5,background:tone,opacity:.85}}/>
                      </div>
                      <div style={{flex:"0 0 66px",textAlign:"right",fontSize:11}} className="aihub_text_muted">{dur?`${Math.round(dur)}ms`:"—"}</div>
                      <div style={{flex:"0 0 74px",textAlign:"right"}}>{levelBadge(o.level)}</div>
                    </div>
                    {o.parent_cycle&&<div style={{marginLeft:14,fontSize:11,color:"#b45309"}}>Parent chain is circular — nesting shown flat.</div>}
                  </div>);
                })}
                {detail.truncated&&<p className="aihub_text_muted" style={{fontSize:11,marginTop:8}}>Only the first 2,000 steps of this trace are shown.</p>}
              </div>)}

            {active&&(<div style={{marginTop:12,padding:12,border:"1px solid #e5e7eb",borderRadius:10,background:"#fff"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,marginBottom:8}}>
                <div style={{fontSize:13,fontWeight:700}}>{active.name||active.type||"step"}</div>
                <div style={{display:"flex",gap:6,alignItems:"center"}}>
                  <Tag text={String(active.type||"SPAN").toLowerCase()} color={obsTone(active.type)}/>
                  {levelBadge(active.level)}
                </div>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))",gap:10,fontSize:12}}>
                <div><div className="aihub_text_muted" style={{fontSize:10.5}}>Model</div><Mono>{active.model||"—"}</Mono></div>
                <div><div className="aihub_text_muted" style={{fontSize:10.5}}>Latency</div>{active.latency_ms==null?"—":`${Math.round(active.latency_ms)}ms`}</div>
                <div><div className="aihub_text_muted" style={{fontSize:10.5}}>Usage</div>
                  {active.usage_details
                    ?<div style={{fontSize:12}}>{fmtTokens(active.usage_details.input)} in · {fmtTokens(active.usage_details.output)} out
                       <span className="aihub_text_muted"> ({fmtTokens(active.usage_details.total)} total)</span></div>
                    :<Mono>—</Mono>}</div>
                <div><div className="aihub_text_muted" style={{fontSize:10.5}}>Cost{active.cost_estimated?" (est.)":""}</div>
                  {active.cost_details
                    ?<div style={{fontSize:12}}>{fmtUsd(active.cost_details.total)}
                       <span className="aihub_text_muted"> ({fmtUsd(active.cost_details.input)} in / {fmtUsd(active.cost_details.output)} out)</span></div>
                    :<Mono>—</Mono>}</div>
              </div>
              {active.status_message&&<p style={{fontSize:12,color:"#b91c1c",margin:"8px 0 0"}}>{active.status_message}</p>}
              <div style={{marginTop:10,display:"flex",gap:8,alignItems:"center"}}>
                {active.has_io
                  ?<button type="button" onClick={()=>loadIo(active)} disabled={io?.status==="loading"}
                     style={{display:"inline-flex",alignItems:"center",gap:6,padding:"5px 12px",borderRadius:6,border:"1px solid #d1d5db",background:"#fff",fontSize:11.5,fontWeight:600,fontFamily:"inherit",cursor:"pointer"}}>
                     <Eye size={12}/>{io?.status==="loading"?"Loading…":"View content"}</button>
                  :<span className="aihub_text_muted" style={{fontSize:11.5}}>No raw content stored for this step — previews only.</span>}
              </div>
              {io?.status==="error"&&<div style={{marginTop:8}}><Err msg={io.message}/></div>}
              {io?.status==="ok"&&(<div style={{marginTop:10}}>
                <div style={{fontSize:10.5,fontWeight:700,color:"#6b7280",textTransform:"uppercase",letterSpacing:.4,marginBottom:3}}>Input</div>
                <pre className="aihub_content_pre" style={{fontSize:12,padding:10,margin:0}}>{typeof io.input==="string"?io.input:JSON.stringify(io.input,null,2)||"—"}</pre>
                <div style={{fontSize:10.5,fontWeight:700,color:"#6b7280",textTransform:"uppercase",letterSpacing:.4,margin:"10px 0 3px"}}>Output</div>
                <pre className="aihub_content_pre" style={{fontSize:12,padding:10,margin:0}}>{typeof io.output==="string"?io.output:JSON.stringify(io.output,null,2)||"—"}</pre>
              </div>)}
            </div>)}
          </div>);
        }}
      />
    </div>)}
  </div>);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 9. CLAUDE USAGE — every Claude surface in one place. Prompt counts are measured
//    everywhere; tokens/cost are MEASURED for Claude Code (the CLI reports them)
//    and ESTIMATED elsewhere. The two are never added together.
// ═══════════════════════════════════════════════════════════════════════════════
// Windows the API already accepts via ?days=N. "" means no filter — the endpoint
// then reports period_days: null and counts everything ever recorded.
const CLAUDE_PERIODS = [
  { value: "7",  label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 3 months" },
  { value: "",   label: "All time" },
];

// Must match CLAUDE_CODE_SURFACE in server/src/lib/claude-clients.js. Claude Code
// in the VS Code / Cursor extension is the same product as Claude Code in a
// terminal, so it is one surface with the client shown underneath.
const CLAUDE_CODE_SURFACE = "Claude Code (CLI/extension)";

function ClaudeUsageView() {
  const [data,setData]=useState(null),[e,setE]=useState(null),[sel,setSel]=useState(null);
  // Defaults to 30 days rather than all time. Without a window the totals are
  // cumulative since tracking began but nothing on screen said so, so a four-figure
  // measured cost read as this month's spend.
  const [days,setDays]=useState("30");
  // Always sources=all — the browser extension is counted, not excluded.
  //
  // Tracker-only mode did not deduplicate, it DROPPED whatever only the extension
  // saw: browser 19 vs 72 prompts, desktop 36 vs 56, over the same 90 days. That
  // undercount is unusable for deciding whose Team seat is idle, which is what this
  // table is for. The double-count it was avoiding is handled properly upstream now
  // — person_key folds one human's enrolments into one row — so there is nothing
  // left for a toggle to protect against.
  useEffect(()=>{
    setData(null); setE(null);
    apiFetch(`/claude-usage?sources=all${days?`&days=${days}`:""}`)
      .then(d=>{ setData(d); if(d.surfaces?.length) setSel(s=>s||d.surfaces[0].surface); })
      .catch(x=>setE(x.message));
  },[days]);

  const periodPicker=(
    <select value={days} onChange={ev=>setDays(ev.target.value)}
            style={{padding:"6px 10px",border:"1px solid #e5e7eb",borderRadius:8,fontSize:12,fontWeight:600}}>
      {CLAUDE_PERIODS.map(p=><option key={p.label} value={p.value}>{p.label}</option>)}
    </select>
  );

  // Header renders in every state so the picker stays usable while loading or after
  // an error — otherwise a slow window would strand you with no way to pick another.
  if(e) return (<div><SectionHeader title="Claude Usage" action={periodPicker}/><Err msg={e}/></div>);
  if(!data) return (<div><SectionHeader title="Claude Usage" action={periodPicker}/><Loading/></div>);

  const surfaces=data.surfaces||[];
  const selected=surfaces.find(s=>s.surface===sel)||null;
  const t=data.totals||{};
  // data.assumptions no longer read here — the footnote that printed
  // chars_per_token and output_ratio was its only consumer. The API still returns
  // it for anyone who needs the estimation basis.

  return (<div>
    {/* Explanatory copy removed: the header hint, the source banner, the Surfaces
        hint and the measured/estimated footnote. The period picker carries the only
        piece of that text a reader still needs — which window the numbers cover. */}
    <SectionHeader title="Claude Usage" action={periodPicker}/>

    <div className="aihub_stat_grid">
      <StatCard icon={<MessageSquare size={18}/>} label="Claude prompts" value={(t.prompts||0).toLocaleString()} hint="all surfaces" color="#8b5cf6"/>
      {/* "Estimated", not "Measured", for the money.
          The token counts really are measured — Claude Code reports them. The dollar
          figure is not: it prices those tokens at pay-as-you-go API rates, and on a
          Team or Max plan seats are flat-rate and nothing is billed per token. So it
          is what this usage WOULD have cost on the API, which is a useful number, but
          calling it measured cost stated it as money spent. */}
      <StatCard icon={<Activity size={18}/>} label="Tokens" value={fmtTokens(t.measured_tokens)} hint={`${(t.measured_requests||0).toLocaleString()} Claude Code requests · includes cached context re-read each turn`} color="#0052e0"/>
      <StatCard icon={<Wrench size={18}/>} label="Estimated cost" value={fmtUsd(t.measured_cost_usd)} hint="at API list rates — Team seats are not billed per token" color="#22c55e"/>
      <StatCard icon={<Clock size={18}/>} label="Est. tokens" value={fmtTokens(t.estimated_tokens)} hint={`≈${fmtUsd(t.estimated_cost_usd)} · browser & desktop, prompt text only`} color="#f59e0b"/>
      {/* The seat-reclamation number. Idle is the one worth reading, so it leads the
          hint — "3 used Claude, 11 did not" is the decision, and the table below
          lists the eleven by name. Counts everyone TRACKED, not everyone licensed:
          the server only knows a person once the tracker or extension enrols. */}
      <StatCard icon={<User size={18}/>} label="Seats tracked" value={(t.enrolled_users||0).toLocaleString()}
                hint={`${(t.idle_users||0).toLocaleString()} with no usage this period · ${(t.active_users||0).toLocaleString()} active`} color="#ef4444"/>
    </div>

    {!(t.prompts>0) && (
      <div className="aihub_card" style={{marginBottom:14}}>
        <Empty icon={<MessageSquare size={32} strokeWidth={1.5}/>} title="No Claude prompts recorded yet" msg="Run the Claude Usage Tracker (.exe) on a machine and send a prompt. Enrolled machines are still listed below at zero — that is what an unused seat looks like."/>
      </div>
    )}

    <>
      <SectionHeader title="By system"/>
      <div className="aihub_card" style={{marginBottom:18}}>
        <DataTable columns={[
          // Email deliberately not shown.
          //
          // The row is keyed on machine + OS user (person_key is
          // "machine:<id>"), but `email` came from a separately claimed Claude
          // account on that machine — so a row for OS user SatyaPinniti on host
          // SATYA was displaying soumya.gande@cloudfuze.com underneath it. The
          // claim is a machine-level fact, not proof of who typed the prompt, and
          // presenting it as the person's address attributes one colleague's usage
          // to another. Machine and OS user are what the tracker actually observes,
          // so those are what is shown. The field is untouched in the API.
          {label:"User",render:r=><div className="aihub_text_primary">{r.user||r.label}</div>},
          {label:"Desktop",render:r=>(r.by_surface?.["Claude Desktop"]||0),right:true},
          {label:"Browser",render:r=>(r.by_surface?.["Claude (browser)"]||0),right:true},
          // Reads the new key first, the pre-rename one second. The API emits both
          // for one release, and this way the column keeps working whichever the
          // server it is talking to happens to send.
          {label:"Code CLI/ext",render:r=>(r.by_surface?.[CLAUDE_CODE_SURFACE]??r.by_surface?.["Claude Code (CLI)"]??0),right:true},
          {label:"Total prompts",render:r=><strong>{(r.prompts||0).toLocaleString()}</strong>,right:true},
          // Both cost fields, summed — not measured_cost_usd alone.
          //
          // Reading only the measured figure meant a browser-only person showed "—"
          // while holding a real estimated_cost_usd: Suditya had 39 prompts and
          // $0.0153, displayed as a dash. On a licence-reclamation screen a dash
          // reads as "no usage", which is the opposite of true.
          //
          // The two were originally kept apart because one is measured and one is
          // inferred. That distinction lived in the column label, and the label is
          // now "Estimated cost" for both — on a Team plan neither is money spent,
          // both are API-rate estimates — so summing no longer overstates confidence.
          {label:"Estimated cost",render:r=>{
            const total=(r.measured_cost_usd||0)+(r.estimated_cost_usd||0);
            return total>0?fmtUsd(total):<span className="aihub_text_muted">—</span>;
          },right:true},
          // Separates "installed and idle" from "we stopped hearing from this
          // machine". Both show 0 prompts, and only the first is evidence for
          // reclaiming a seat — the second means the tracker is not running, so
          // the zero says nothing about whether the person uses Claude.
          {label:"Last seen",render:r=>r.last_seen
            ? <span className={r.active?undefined:"aihub_text_muted"}>{relTime(r.last_seen)}</span>
            : <span className="aihub_text_muted">—</span>},
        ]} rows={data.systems||[]}
           empty="No machines enrolled yet — install the Claude Usage Tracker to start tracking seats."/>
      </div>

      <SectionHeader title="Surfaces"/>
      <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:14}}>
        {surfaces.map(s=>(
          <button key={s.surface} className={`aihub_filter_btn ${sel===s.surface?"active":""}`} onClick={()=>setSel(s.surface)}
                  style={s.prompts?undefined:{opacity:0.62}}>
            {s.surface} · {(s.prompts||0).toLocaleString()} prompts
            {s.measured_tokens>0 && <> · {fmtUsd(s.measured_cost_usd)}</>}
          </button>
        ))}
      </div>

      {/* Which client the Claude Code prompts came from. Only that surface reports
          it, so the strip is absent everywhere else rather than showing a single
          meaningless "Unknown" bar. Percentages are of this surface's prompts —
          the question being answered is "how much of our Claude Code use is the
          IDE extension?", which is a share, not a count. */}
      {selected?.clients?.length>0 && (
        <div className="aihub_card" style={{marginBottom:14}}>
          <SectionHeader title="By client"/>
          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
            {selected.clients.map(c=>{
              const pct=selected.prompts?Math.round((c.prompts/selected.prompts)*100):0;
              const unknown=c.client==="Unknown";
              return (
                <div key={c.client} className="aihub_filter_btn" style={{cursor:"default",opacity:unknown?0.62:1}}>
                  <strong>{c.client}</strong> · {(c.prompts||0).toLocaleString()} prompts · {pct}%
                  <span className="aihub_text_muted"> · {c.users} {c.users===1?"person":"people"}</span>
                </div>
              );
            })}
          </div>
          {selected.clients.some(c=>c.client==="Unknown") && (
            <div className="aihub_text_muted" style={{marginTop:10,fontSize:12}}>
              “Unknown” means Claude Code’s telemetry for that session never reached the server,
              so the client was not reported. Those prompts are still counted — they are not
              assumed to be terminal sessions.
            </div>
          )}
        </div>
      )}

      {selected && <div className="aihub_card">
        {/* Sub-line removed. The surface buttons above already carry the prompt
            count, and the table below carries the per-user tokens and cost. */}
        <SectionHeader title={`${selected.surface} — usage by user`}/>
        <DataTable columns={[
          {label:"User",render:r=><><div className="aihub_text_primary">{r.label||r.user||r.hostname||"—"}</div>{!r.attributed&&<div className="aihub_text_muted">unattributed</div>}</>},
          // Per-person client mix, so "the team uses the extension" can be checked
          // against who actually does. Rendered as "VS Code 41 · Terminal 12"
          // rather than one winner, because people genuinely split across both.
          ...(selected.clients?.length>0?[{label:"Client",render:r=>(
            r.clients?.length
              ? <span>{r.clients.map(c=>`${c.client} ${c.prompts}`).join(" · ")}</span>
              : <span className="aihub_text_muted">—</span>
          )}]:[]),
          {label:"Prompts",key:"prompts",right:true},
          {label:"Tokens",render:r=>fmtTokens(r.tokens),right:true},
          {label:"Cost",render:r=>fmtUsd(r.cost_usd),right:true},
          // Basis and Model columns removed. Line comments, not {/* … */} — inside a
          // JS array the braced form is an empty object literal, which renders as a
          // blank extra column.
          //
          // Basis said measured/estimated per row; the note under the table already
          // explains which surfaces are which, and every browser and desktop row was
          // "estimated" regardless. Model was "—" on those same rows, since only
          // Claude Code reports one.
        ]} rows={selected.breakdown||[]} empty={`No ${selected.surface} prompts recorded yet.`}/>
      </div>}

    </>
  </div>);
}

// ── AI Usage View ────────────────────────────────────────────────────────
function AIUsageView() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    fetch("/api/v1/ai-usage").then(r => r.json()).then(setData).catch(e => setErr(e.message));
  }, []);
  if (err) return <Err msg={err} />;
  if (!data) return <Loading />;

  const totals = data.totals || {};
  const platforms = data.platforms || [];

  return (
    <div>
      <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
        <StatCard icon={<MessageSquare size={18} />} label="Total Prompts" value={totals.prompts || 0} hint="Across all AI tools" color="#2563eb" />
        <StatCard icon={<Activity size={18} />} label="Est. Tokens" value={fmtTokens(totals.est_total_tokens)} hint="Estimated usage" color="#8b5cf6" />
        <StatCard icon={<Shield size={18} />} label="Est. Cost" value={fmtUsd(totals.est_cost_usd)} hint="Estimated spend" color="#f59e0b" />
        <StatCard icon={<Server size={18} />} label="AI Platforms" value={platforms.length} hint="Active" color="#22c55e" />
      </div>

      <SectionHeader title="Usage by AI Platform" hint="Prompt counts and estimated token usage per AI tool" />
      <DataTable
        columns={[
          // r.ai_service, not r.service, and r.breakdown, not r.users — those two
          // names never existed on this payload. 10 of 17 rows have a null
          // `product`, so the Platform cell fell through to undefined and rendered
          // blank; every per-user table read `p.users` and showed "No users" while
          // `breakdown` held the real rows.
          { label: "Platform", render: r => <div><div className="aihub_text_primary">{r.product || r.ai_service}</div>{r.vendor && <div className="aihub_text_muted" style={{ fontSize: 11 }}>{r.vendor}</div>}</div> },
          { label: "Prompts", key: "prompts", right: true },
          { label: "Est. Tokens", render: r => fmtTokens(r.est_total_tokens), right: true },
          { label: "Est. Cost", render: r => fmtUsd(r.est_cost_usd), right: true },
          { label: "Users", render: r => (r.breakdown || []).length, right: true },
        ]}
        rows={platforms}
        empty="No AI usage data yet. Install the browser extension to start capturing."
      />

      {platforms.length > 0 && (<>
        <SectionHeader title="Usage by User" hint="Per-user breakdown across all AI platforms" />
        {platforms.map(p => (
          // key={p.ai_service}: p.service was undefined for all 17 rows, so React
          // saw seventeen children with the same undefined key.
          <div key={p.ai_service} style={{ marginBottom: 16 }}>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>{p.product || p.ai_service}</div>
            <DataTable
              columns={[
                // breakdown rows carry label / user / hostname — `identity` is not
                // one of them. Prefer the human label the server already resolved.
                { label: "User", render: r => <span style={{ fontSize: 12 }}>{r.label || r.user || r.hostname || "Unknown"}</span> },
                { label: "Prompts", key: "prompts", right: true },
                { label: "Est. Tokens", render: r => fmtTokens(r.est_total_tokens), right: true },
                { label: "Est. Cost", render: r => fmtUsd(r.est_cost_usd), right: true },
              ]}
              rows={p.breakdown || []}
              empty="No users"
            />
          </div>
        ))}
      </>)}

      <p className="aihub_text_muted" style={{ fontSize: 11, marginTop: 8 }}>
        Token and cost estimates are based on captured prompt lengths. Actual billed usage may differ.
      </p>
    </div>
  );
}

// ── Integrations View (Webhooks) ──────────────────────────────────────────

const WEBHOOK_API = "/api/v1/webhooks";
const CONNECTIONS_API = "/api/v1/connections";

function IntegrationsView() {
  const [connections,setConnections]=useState(null);
  const [hooks,setHooks]=useState(null);
  const [templates,setTemplates]=useState(null);
  const [triggersList,setTriggersList]=useState([]);
  const [deliveryLog,setLog]=useState(null);
  const [err,setErr]=useState(null);
  const [tab,setTab]=useState("webhooks");
  const [showForm,setShowForm]=useState(false);
  const [editId,setEditId]=useState(null);
  const [testing,setTesting]=useState(null);
  const [fName,setFName]=useState("");
  const [fUrl,setFUrl]=useState("");
  const [fTemplate,setFTemplate]=useState("slack");
  const [fTriggers,setFTriggers]=useState([]);
  const [fAuth,setFAuth]=useState("");
  const [fChannelId,setFChannelId]=useState("");
  const [channelData,setChannelData]=useState(null);
  const [channelSearch,setChannelSearch]=useState("");
  const [expandedTeam,setExpandedTeam]=useState(null);
  const [teamChannels,setTeamChannels]=useState({});  // teamId → channels[]
  const [loadingTeamCh,setLoadingTeamCh]=useState(null);
  // Connection config form
  const [configType,setConfigType]=useState(null);
  const [cfgSlackToken,setCfgSlackToken]=useState("");
  const [cfgTeamsClientId,setCfgTeamsClientId]=useState("");
  const [cfgTeamsSecret,setCfgTeamsSecret]=useState("");
  const [cfgTeamsTenant,setCfgTeamsTenant]=useState("");
  const [cfgSaving,setCfgSaving]=useState(false);

  const loadAll=()=>{
    Promise.all([
      fetch(CONNECTIONS_API).then(r=>r.json()),
      fetch(WEBHOOK_API).then(r=>r.json()),
      fetch(WEBHOOK_API+"/templates").then(r=>r.json()),
      fetch(WEBHOOK_API+"/log").then(r=>r.json()),
    ]).then(([c,h,t,l])=>{setConnections(c);setHooks(h);setTemplates(t.templates);setTriggersList(t.triggers);setLog(l);}).catch(x=>setErr(x.message));
  };
  useEffect(()=>{ loadAll(); },[]);

  const [teamsManualUpload,setTeamsManualUpload]=useState(false);
  const [showHelp,setShowHelp]=useState(null); // 'slack' | 'teams' | null

  const saveConnection=async(type)=>{
    setCfgSaving(true);
    setTeamsManualUpload(false);
    try {
      const body=type==='slack'?{bot_token:cfgSlackToken}:{client_id:cfgTeamsClientId,client_secret:cfgTeamsSecret,tenant_id:cfgTeamsTenant};
      const r=await fetch(CONNECTIONS_API+"/"+type,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
      const d=await r.json();
      if(!r.ok){alert("Error: "+(d.error||"Failed"));setCfgSaving(false);return;}
      if(d.manual_upload_needed){
        setTeamsManualUpload(true);
        setCfgSaving(false);
        loadAll();
        return;
      }
      setConfigType(null);setCfgSlackToken("");setCfgTeamsClientId("");setCfgTeamsSecret("");setCfgTeamsTenant("");loadAll();
    } catch(e){alert(e.message);}
    setCfgSaving(false);
  };

  const disconnect=async(type)=>{
    if(!confirm("Disconnect "+type+"? Existing webhooks using this connection will stop working.")) return;
    await fetch(CONNECTIONS_API+"/"+type,{method:"DELETE"});loadAll();
  };

  const [loadingChannels,setLoadingChannels]=useState(false);
  const loadChannels=async(type)=>{
    setLoadingChannels(true);
    setChannelData(null);
    setChannelSearch("");
    try {
      const r=await fetch(CONNECTIONS_API+"/"+type+"/channels");
      if(r.ok) setChannelData(await r.json());
    } catch {}
    setLoadingChannels(false);
  };

  const save=async()=>{
    if(!fName)return;
    const isDirectConn=fTemplate==='slack'||fTemplate==='teams';
    const body={name:fName,template:fTemplate,triggers:fTriggers};
    if(isDirectConn){
      // Direct connection mode — no URL needed, use channel_id
      if(!fChannelId){alert("Please select a channel");return;}
      body.connection_type=fTemplate;
      body.channel_id=fChannelId;
      body.url='direct://'+fTemplate; // placeholder — not used for posting
    } else {
      // Legacy webhook URL mode
      if(!fUrl)return;
      body.url=fUrl;
      body.auth_header=fAuth||null;
    }
    if(editId) await fetch(`${WEBHOOK_API}/${editId}`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
    else await fetch(WEBHOOK_API,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
    closeForm();loadAll();
  };
  const closeForm=()=>{setShowForm(false);setEditId(null);setFName("");setFUrl("");setFTemplate("slack");setFTriggers([]);setFAuth("");setFChannelId("");setChannelData(null);setChannelSearch("");};
  const startEdit=(h)=>{setEditId(h.id);setFName(h.name);setFUrl(h.url);setFTemplate(h.template||"custom");setFTriggers(h.triggers||[]);setFAuth(h.auth_header||"");setShowForm(true);};
  const remove=async(id)=>{if(!confirm("Delete this webhook?"))return;await fetch(`${WEBHOOK_API}/${id}`,{method:"DELETE"});loadAll();};
  const toggle=async(h)=>{await fetch(`${WEBHOOK_API}/${h.id}`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({enabled:!h.enabled})});loadAll();};
  const test=async(id)=>{setTesting(id);const r=await fetch(`${WEBHOOK_API}/${id}/test`,{method:"POST"});const d=await r.json();alert(d.ok?"Test delivered successfully!":"Test failed: "+(d.error||"HTTP "+d.status));setTesting(null);loadAll();};

  if(err) return <Err msg={err}/>;
  if(!hooks) return <Loading/>;

  const TL={dlp_critical:"DLP Critical Violation",risk_score_high:"Risk Score → High",access_request:"New Access Request",tool_blocked:"Tool Blocked",tool_approved:"Tool Approved"};
  const TI={slack:"💬",teams:"👥",jira:"🎫",servicenow:"🔧",custom:"⚡"};

  const configuredCount=(connections||[]).filter(c=>c.status==='configured').length;
  const configuredConnections=(connections||[]).filter(c=>c.status==='configured');

  return (<div>
    <SectionHeader title="Integrations" hint="Connect CloudFuze to your existing tools — notifications, ticketing, identity, and cloud platforms"/>

    {/* Tabs: Webhooks | Delivery Log | Connections */}
    <div style={{display:"flex",gap:2,marginBottom:16,borderBottom:"2px solid #eff1f3"}}>
      {[
        {id:"webhooks",label:"Webhooks ("+hooks.length+")"},
        {id:"log",label:"Delivery Log"},
        {id:"connections",label:"Connections ("+configuredCount+"/"+((connections||[]).length)+")"},
      ].map(t=>
        <button key={t.id} onClick={()=>setTab(t.id)} style={{padding:"10px 20px",fontSize:13,fontWeight:tab===t.id?700:500,border:"none",borderBottom:tab===t.id?"2px solid #0052e0":"2px solid transparent",background:"none",color:tab===t.id?"#0052e0":"#8b919e",cursor:"pointer",marginBottom:-2,fontFamily:"inherit",transition:"all 0.15s"}}>{t.label}</button>
      )}
    </div>

    {/* Connections Tab */}
    {tab==="connections"&&(
      <div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:14,marginBottom:16}}>
          {(connections||[]).map(c=>(
            <div key={c.type} style={{border:"1px solid "+(c.status==='configured'?"#22c55e30":"#e2e5ea"),borderRadius:12,padding:18,background:c.status==='configured'?"#f0fdf4":"#fff"}}>
              <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12}}>
                <span style={{fontSize:30}}>{c.icon}</span>
                <div>
                  <div style={{fontWeight:700,fontSize:15}}>{c.name}</div>
                  <div style={{fontSize:12,color:"#9ca3af"}}>{c.description}</div>
                </div>
              </div>
              {c.status==='configured'?(
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"8px 12px",background:"#22c55e0a",borderRadius:8,border:"1px solid #22c55e20"}}>
                  <span style={{fontSize:12,fontWeight:700,color:"#22c55e"}}>✓ Connected</span>
                  <button onClick={()=>disconnect(c.type)} style={{fontSize:11,color:"#ef4444",background:"none",border:"none",cursor:"pointer"}}>Disconnect</button>
                </div>
              ):(
                <button onClick={()=>setConfigType(c.type)} style={{width:"100%",padding:"8px 0",borderRadius:8,border:"1px solid #0044cc30",background:"#0044cc08",color:"#0052e0",fontSize:13,fontWeight:600,cursor:"pointer"}}>Configure</button>
              )}
            </div>
          ))}
        </div>

        {/* Slack Config Form */}
        {configType==='slack'&&(
          <div className="aihub_card" style={{background:"#f5f6f8"}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
              <h4 style={{margin:0,fontSize:14,fontWeight:700}}>Connect Slack</h4>
              <div style={{position:"relative"}}>
                <button onClick={()=>setShowHelp('slack')} style={{background:"none",border:"1px solid #0044cc30",borderRadius:"50%",width:28,height:28,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",color:"#0052e0",fontWeight:700,fontSize:14}}>?</button>
                {!cfgSlackToken&&<div style={{position:"absolute",right:36,top:4,whiteSpace:"nowrap",fontSize:11,color:"#0052e0",fontWeight:600,animation:"cfai-fade-in .3s"}}>Need help? Click here →</div>}
              </div>
            </div>
            <div style={{marginBottom:12}}>
              <label style={{fontSize:12,fontWeight:600,color:"#374151",display:"block",marginBottom:4}}>Bot Token</label>
              <input value={cfgSlackToken} onChange={e=>setCfgSlackToken(e.target.value)} placeholder="xoxb-..." style={{width:"100%",padding:"8px 12px",border:"1px solid #e5e7eb",borderRadius:8,fontSize:13,boxSizing:"border-box"}}/>
            </div>
            <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
              <button onClick={()=>setConfigType(null)} style={{padding:"8px 20px",borderRadius:8,border:"1px solid #e5e7eb",background:"#fff",cursor:"pointer",fontSize:13}}>Cancel</button>
              <button onClick={()=>saveConnection('slack')} disabled={!cfgSlackToken||cfgSaving} style={{padding:"8px 20px",borderRadius:8,border:"none",background:"#0052e0",color:"#fff",cursor:"pointer",fontSize:13,fontWeight:600,opacity:!cfgSlackToken||cfgSaving?0.5:1}}>{cfgSaving?"Verifying...":"Connect"}</button>
            </div>
          </div>
        )}

        {/* Teams Config Form */}
        {configType==='teams'&&(
          <div className="aihub_card" style={{background:"#f5f6f8"}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
              <h4 style={{margin:0,fontSize:14,fontWeight:700}}>Connect Microsoft Teams</h4>
              <div style={{position:"relative"}}>
                <button onClick={()=>setShowHelp('teams')} style={{background:"none",border:"1px solid #0044cc30",borderRadius:"50%",width:28,height:28,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",color:"#0052e0",fontWeight:700,fontSize:14}}>?</button>
                {!cfgTeamsClientId&&<div style={{position:"absolute",right:36,top:4,whiteSpace:"nowrap",fontSize:11,color:"#0052e0",fontWeight:600,animation:"cfai-fade-in .3s"}}>Need help? Click here →</div>}
              </div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12}}>
              <div>
                <label style={{fontSize:12,fontWeight:600,color:"#374151",display:"block",marginBottom:4}}>Client ID</label>
                <input value={cfgTeamsClientId} onChange={e=>setCfgTeamsClientId(e.target.value)} placeholder="Azure App Client ID" style={{width:"100%",padding:"8px 12px",border:"1px solid #e5e7eb",borderRadius:8,fontSize:13,boxSizing:"border-box"}}/>
              </div>
              <div>
                <label style={{fontSize:12,fontWeight:600,color:"#374151",display:"block",marginBottom:4}}>Tenant ID</label>
                <input value={cfgTeamsTenant} onChange={e=>setCfgTeamsTenant(e.target.value)} placeholder="Azure Tenant ID" style={{width:"100%",padding:"8px 12px",border:"1px solid #e5e7eb",borderRadius:8,fontSize:13,boxSizing:"border-box"}}/>
              </div>
            </div>
            <div style={{marginBottom:12}}>
              <label style={{fontSize:12,fontWeight:600,color:"#374151",display:"block",marginBottom:4}}>Client Secret</label>
              <input type="password" value={cfgTeamsSecret} onChange={e=>setCfgTeamsSecret(e.target.value)} placeholder="Azure App Client Secret" style={{width:"100%",padding:"8px 12px",border:"1px solid #e5e7eb",borderRadius:8,fontSize:13,boxSizing:"border-box"}}/>
            </div>
            {teamsManualUpload&&(
              <div style={{marginBottom:12,padding:14,background:"#fff7ed",border:"1px solid #fed7aa",borderRadius:10}}>
                <div style={{fontWeight:700,fontSize:13,color:"#92400e",marginBottom:6}}>⚠ Connected — but bot app needs manual upload</div>
                <div style={{fontSize:12,color:"#78350f",lineHeight:1.6,marginBottom:10}}>
                  Your org policy blocks automated app uploads. The credentials are saved and working. To complete setup:<br/>
                  1. Download the bot manifest below<br/>
                  2. Go to <strong>Teams Admin Center</strong> → Teams apps → Manage apps → Upload new app<br/>
                  3. Select the downloaded zip file<br/>
                  After upload, webhooks will auto-install the bot in any team you select.
                </div>
                <a href={CONNECTIONS_API+"/teams/manifest"} download="CloudFuze-Alerts-Bot.zip"
                  style={{display:"inline-flex",alignItems:"center",gap:6,padding:"8px 16px",borderRadius:8,border:"none",background:"#0052e0",color:"#fff",fontSize:13,fontWeight:600,textDecoration:"none",cursor:"pointer"}}>
                  ⬇ Download Manifest ZIP
                </a>
              </div>
            )}
            <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
              <button onClick={()=>{setConfigType(null);setTeamsManualUpload(false);}} style={{padding:"8px 20px",borderRadius:8,border:"1px solid #e5e7eb",background:"#fff",cursor:"pointer",fontSize:13}}>{teamsManualUpload?"Done":"Cancel"}</button>
              {!teamsManualUpload&&<button onClick={()=>saveConnection('teams')} disabled={!cfgTeamsClientId||!cfgTeamsSecret||!cfgTeamsTenant||cfgSaving} style={{padding:"8px 20px",borderRadius:8,border:"none",background:"#0052e0",color:"#fff",cursor:"pointer",fontSize:13,fontWeight:600,opacity:(!cfgTeamsClientId||!cfgTeamsSecret||!cfgTeamsTenant||cfgSaving)?0.5:1}}>{cfgSaving?"Verifying...":"Connect"}</button>}
            </div>
          </div>
        )}
      </div>
    )}

    {/* Help Modal */}
    {showHelp&&(
      <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center"}} onClick={()=>setShowHelp(null)}>
        <div style={{background:"#fff",borderRadius:14,padding:28,width:640,maxHeight:"85vh",overflowY:"auto",boxShadow:"0 20px 60px rgba(0,0,0,0.2)"}} onClick={e=>e.stopPropagation()}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:18}}>
            <h3 style={{margin:0,fontSize:18,fontWeight:700}}>{showHelp==='slack'?'How to Connect Slack':'How to Connect Microsoft Teams'}</h3>
            <button onClick={()=>setShowHelp(null)} style={{background:"none",border:"none",cursor:"pointer",fontSize:20,color:"#6b7280"}}>✕</button>
          </div>

          {showHelp==='slack'&&(<div style={{fontSize:13,color:"#374151",lineHeight:1.8}}>
            <div style={{fontWeight:700,fontSize:14,color:"#0052e0",marginBottom:8}}>Step 1 — Create a Slack App</div>
            <ol style={{paddingLeft:20,marginBottom:16}}>
              <li>Go to <strong>api.slack.com/apps</strong></li>
              <li>Click <strong>Create New App</strong> → <strong>Blank app</strong></li>
              <li>App name: <code style={{background:"#f1f5f9",padding:"1px 6px",borderRadius:3}}>CloudFuze Alerts</code></li>
              <li>Pick your workspace → <strong>Create App</strong></li>
            </ol>
            <div style={{fontWeight:700,fontSize:14,color:"#0052e0",marginBottom:8}}>Step 2 — Add Bot Permissions</div>
            <ol style={{paddingLeft:20,marginBottom:16}}>
              <li>Left sidebar → <strong>OAuth & Permissions</strong></li>
              <li>Scroll to <strong>Bot Token Scopes</strong></li>
              <li>Click <strong>Add an OAuth Scope</strong> and add these:
                <div style={{display:"flex",gap:6,marginTop:6,flexWrap:"wrap"}}>
                  <code style={{background:"#dbeafe",padding:"2px 8px",borderRadius:4,fontSize:12}}>chat:write</code>
                  <code style={{background:"#dbeafe",padding:"2px 8px",borderRadius:4,fontSize:12}}>channels:read</code>
                  <code style={{background:"#dbeafe",padding:"2px 8px",borderRadius:4,fontSize:12}}>channels:join</code>
                  <code style={{background:"#dbeafe",padding:"2px 8px",borderRadius:4,fontSize:12}}>groups:read</code>
                </div>
              </li>
            </ol>
            <div style={{fontWeight:700,fontSize:14,color:"#0052e0",marginBottom:8}}>Step 3 — Install & Copy Token</div>
            <ol style={{paddingLeft:20,marginBottom:16}}>
              <li>Scroll up → <strong>Install to Workspace</strong> → <strong>Allow</strong></li>
              <li>Copy the <strong>Bot User OAuth Token</strong> (starts with <code>xoxb-</code>)</li>
              <li>Paste it in the field below and click <strong>Connect</strong></li>
            </ol>
            <div style={{background:"#f0fdf4",border:"1px solid #bbf7d0",borderRadius:8,padding:12,fontSize:12,color:"#166534"}}>
              <strong>That's it!</strong> CloudFuze will automatically join any channel you select when creating webhooks. No manual bot invites needed.
            </div>
          </div>)}

          {showHelp==='teams'&&(<div style={{fontSize:13,color:"#374151",lineHeight:1.8}}>
            <div style={{fontWeight:700,fontSize:14,color:"#0052e0",marginBottom:8}}>Step 1 — Create Azure Bot Resource</div>
            <ol style={{paddingLeft:20,marginBottom:16}}>
              <li>Go to <strong>portal.azure.com</strong></li>
              <li>Search <strong>"Azure Bot"</strong> in the top search bar → click under Marketplace → <strong>Create</strong></li>
              <li>Fill in: Bot handle: <code style={{background:"#f1f5f9",padding:"1px 6px",borderRadius:3}}>CloudFuze-Alerts-Bot</code>, Type: <strong>Multi Tenant</strong></li>
              <li>Click <strong>Review + Create</strong> → <strong>Create</strong></li>
            </ol>
            <div style={{fontWeight:700,fontSize:14,color:"#0052e0",marginBottom:8}}>Step 2 — Get App ID & Secret</div>
            <ol style={{paddingLeft:20,marginBottom:16}}>
              <li>Go to <strong>Azure Portal</strong> → <strong>App registrations</strong> → find your bot</li>
              <li>Copy the <strong>Application (client) ID</strong> and <strong>Directory (tenant) ID</strong></li>
              <li>Go to <strong>Certificates & secrets</strong> → <strong>New client secret</strong> → copy the <strong>Value</strong></li>
            </ol>
            <div style={{fontWeight:700,fontSize:14,color:"#0052e0",marginBottom:8}}>Step 3 — Enable Teams Channel</div>
            <ol style={{paddingLeft:20,marginBottom:16}}>
              <li>Go to the <strong>Azure Bot</strong> resource (not App registration)</li>
              <li>Left sidebar → <strong>Channels</strong> → select <strong>Microsoft Teams</strong> → <strong>Apply</strong></li>
            </ol>
            <div style={{fontWeight:700,fontSize:14,color:"#0052e0",marginBottom:8}}>Step 4 — Add API Permissions</div>
            <ol style={{paddingLeft:20,marginBottom:16}}>
              <li>Go to <strong>App registrations</strong> → your bot → <strong>API permissions</strong></li>
              <li>Click <strong>Add a permission</strong> → <strong>Microsoft Graph</strong> → <strong>Application permissions</strong></li>
              <li>Add these permissions:
                <div style={{display:"flex",gap:6,marginTop:6,flexWrap:"wrap"}}>
                  <code style={{background:"#dbeafe",padding:"2px 8px",borderRadius:4,fontSize:12}}>Group.Read.All</code>
                  <code style={{background:"#dbeafe",padding:"2px 8px",borderRadius:4,fontSize:12}}>Team.ReadBasic.All</code>
                  <code style={{background:"#dbeafe",padding:"2px 8px",borderRadius:4,fontSize:12}}>Channel.ReadBasic.All</code>
                  <code style={{background:"#dbeafe",padding:"2px 8px",borderRadius:4,fontSize:12}}>AppCatalog.Read.All</code>
                  <code style={{background:"#dbeafe",padding:"2px 8px",borderRadius:4,fontSize:12}}>AppCatalog.ReadWrite.All</code>
                  <code style={{background:"#dbeafe",padding:"2px 8px",borderRadius:4,fontSize:12}}>TeamsAppInstallation.ReadWriteForTeam.All</code>
                </div>
              </li>
              <li>Click <strong>Grant admin consent for [your org]</strong></li>
            </ol>
            <div style={{fontWeight:700,fontSize:14,color:"#0052e0",marginBottom:8}}>Step 5 — Connect in CloudFuze</div>
            <ol style={{paddingLeft:20,marginBottom:16}}>
              <li>Paste <strong>Client ID</strong>, <strong>Tenant ID</strong>, and <strong>Client Secret</strong> below</li>
              <li>Click <strong>Connect</strong></li>
              <li>CloudFuze will auto-publish the bot to your org's app catalog</li>
              <li>If auto-publish fails, download the manifest and upload manually via <strong>Teams Admin Center</strong></li>
            </ol>
            <div style={{background:"#f0fdf4",border:"1px solid #bbf7d0",borderRadius:8,padding:12,fontSize:12,color:"#166534"}}>
              <strong>Once connected,</strong> CloudFuze will automatically install the bot in any team you select when creating webhooks. No manual app installs needed.
            </div>
          </div>)}

          <div style={{display:"flex",justifyContent:"flex-end",marginTop:16}}>
            <button onClick={()=>setShowHelp(null)} style={{padding:"8px 24px",borderRadius:8,border:"none",background:"#0052e0",color:"#fff",cursor:"pointer",fontSize:13,fontWeight:600}}>Got it</button>
          </div>
        </div>
      </div>
    )}

    {tab==="webhooks"&&(<div>
      <div style={{display:"flex",justifyContent:"flex-end",marginBottom:12}}>
        <button onClick={()=>{
          const firstConn=configuredConnections[0];
          const defaultType=firstConn?.type||'custom';
          setFTemplate(defaultType);
          setShowForm(true);
          if(defaultType==='slack'||defaultType==='teams') loadChannels(defaultType);
        }} style={{display:"flex",alignItems:"center",gap:6,padding:"8px 16px",borderRadius:8,border:"none",background:"#0052e0",color:"#fff",cursor:"pointer",fontSize:13,fontWeight:600}}><Plus size={14}/> Add Webhook</button>
      </div>
      {showForm&&(<div className="aihub_card" style={{marginBottom:16,background:"#f5f6f8"}}>
        <h4 style={{margin:"0 0 12px",fontSize:14,fontWeight:700}}>{editId?"Edit Webhook":"New Webhook"}</h4>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12}}>
          <div><label style={{fontSize:12,fontWeight:600,color:"#374151"}}>Name</label><input value={fName} onChange={e=>setFName(e.target.value)} placeholder="e.g. Security Alerts Slack" style={{width:"100%",padding:"8px 12px",border:"1px solid #e5e7eb",borderRadius:8,fontSize:13,marginTop:4,boxSizing:"border-box"}}/></div>
          <div><label style={{fontSize:12,fontWeight:600,color:"#374151"}}>Send To</label><select value={fTemplate} onChange={e=>{setFTemplate(e.target.value);setFChannelId("");setChannelData(null);setChannelSearch("");if(e.target.value==='slack'||e.target.value==='teams')loadChannels(e.target.value);}} style={{width:"100%",padding:"8px 12px",border:"1px solid #e5e7eb",borderRadius:8,fontSize:13,marginTop:4,boxSizing:"border-box"}}>
            {configuredConnections.map(c=><option key={c.type} value={c.type}>{c.icon+" "+c.name}</option>)}
            <option value="custom">⚡ Custom Webhook URL</option>
          </select></div>
        </div>

        {/* Channel picker for direct connections */}
        {(fTemplate==='slack'||fTemplate==='teams')&&(
          <div style={{marginBottom:12}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:4}}>
              <label style={{fontSize:12,fontWeight:600,color:"#374151"}}>Channel {fChannelId&&<span style={{fontWeight:400,color:"#22c55e"}}> ✓ selected</span>}</label>
              <button type="button" onClick={()=>loadChannels(fTemplate)} disabled={loadingChannels} style={{fontSize:11,color:"#0052e0",background:"none",border:"none",cursor:"pointer",fontWeight:600}}>{loadingChannels?"Loading...":"↻ Refresh"}</button>
            </div>
            {loadingChannels?(
              <div style={{padding:"16px",background:"#f5f6f8",borderRadius:8,fontSize:12,color:"#6b7280",textAlign:"center"}}>Loading from {fTemplate==='slack'?'Slack':'Microsoft Teams'}...</div>
            ):channelData?(()=>{
              const q=channelSearch.toLowerCase();

              if(channelData.type==='hierarchical'){
                // Teams — show teams, click to expand and lazy-load channels
                const filteredTeams=(channelData.teams||[]).filter(t=>!q||t.team_name.toLowerCase().includes(q));
                const expandTeam=async(teamId)=>{
                  if(expandedTeam===teamId){setExpandedTeam(null);return;}
                  setExpandedTeam(teamId);
                  if(!teamChannels[teamId]){
                    setLoadingTeamCh(teamId);
                    try{
                      const r=await fetch(CONNECTIONS_API+"/teams/team/"+teamId+"/channels");
                      if(r.ok){const chs=await r.json();setTeamChannels(prev=>({...prev,[teamId]:chs}));}
                    }catch{}
                    setLoadingTeamCh(null);
                  }
                };
                return (<div style={{border:"1px solid #e5e7eb",borderRadius:8,overflow:"hidden"}}>
                  <div style={{padding:"8px 10px",borderBottom:"1px solid #e5e7eb",background:"#f5f6f8"}}>
                    <input value={channelSearch} onChange={e=>setChannelSearch(e.target.value)} placeholder={"Search "+filteredTeams.length+" teams..."} style={{width:"100%",border:"none",background:"transparent",outline:"none",fontSize:12,boxSizing:"border-box"}}/>
                  </div>
                  <div style={{maxHeight:300,overflowY:"auto"}}>
                    {filteredTeams.length===0&&<div style={{padding:12,textAlign:"center",fontSize:12,color:"#9ca3af"}}>No teams match "{channelSearch}"</div>}
                    {filteredTeams.map(t=>(
                      <div key={t.team_id}>
                        <div onClick={()=>expandTeam(t.team_id)} style={{padding:"8px 12px",fontSize:12,fontWeight:600,color:"#374151",background:expandedTeam===t.team_id?"#eef2ff":"#f9fafb",borderBottom:"1px solid #f3f4f6",cursor:"pointer",display:"flex",alignItems:"center",gap:6}}>
                          <span style={{fontSize:10,color:"#6b7280"}}>{expandedTeam===t.team_id?"▼":"▶"}</span> 🏢 {t.team_name}
                        </div>
                        {expandedTeam===t.team_id&&(
                          loadingTeamCh===t.team_id?
                            <div style={{padding:"8px 32px",fontSize:11,color:"#9ca3af"}}>Loading channels...</div>
                          :(teamChannels[t.team_id]||[]).map(ch=>(
                            <div key={ch.id} onClick={()=>setFChannelId(ch.id)}
                              style={{padding:"7px 12px 7px 36px",fontSize:12,cursor:"pointer",borderBottom:"1px solid #f9fafb",
                                background:fChannelId===ch.id?"#0044cc10":"#fff",color:fChannelId===ch.id?"#0052e0":"#374151",fontWeight:fChannelId===ch.id?600:400}}>
                              # {ch.name}
                            </div>
                          ))
                        )}
                      </div>
                    ))}
                  </div>
                </div>);

              } else {
                // Slack — flat list
                const chs=(channelData.channels||[]).filter(ch=>!q||ch.name.toLowerCase().includes(q));
                return (<div style={{border:"1px solid #e5e7eb",borderRadius:8,overflow:"hidden"}}>
                  <div style={{padding:"8px 10px",borderBottom:"1px solid #e5e7eb",background:"#f5f6f8"}}>
                    <input value={channelSearch} onChange={e=>setChannelSearch(e.target.value)} placeholder={"Search "+chs.length+" channels..."} style={{width:"100%",border:"none",background:"transparent",outline:"none",fontSize:12,boxSizing:"border-box"}}/>
                  </div>
                  <div style={{maxHeight:300,overflowY:"auto"}}>
                    {chs.length===0&&<div style={{padding:12,textAlign:"center",fontSize:12,color:"#9ca3af"}}>No channels match "{channelSearch}"</div>}
                    {chs.map(ch=>(
                      <div key={ch.id} onClick={()=>setFChannelId(ch.id)}
                        style={{padding:"7px 12px",fontSize:12,cursor:"pointer",borderBottom:"1px solid #f9fafb",
                          background:fChannelId===ch.id?"#0044cc10":"#fff",color:fChannelId===ch.id?"#0052e0":"#374151",fontWeight:fChannelId===ch.id?600:400}}>
                        {ch.name} {ch.is_private&&<span style={{fontSize:10,color:"#9ca3af"}}>🔒</span>}
                      </div>
                    ))}
                  </div>
                </div>);
              }
            })():(
              <div style={{padding:"10px 12px",background:"#fff7ed",borderRadius:8,fontSize:12,color:"#92400e",border:"1px solid #fed7aa"}}>Click "↻ Refresh" to load from {fTemplate==='slack'?'Slack':'Microsoft Teams'}</div>
            )}
          </div>
        )}

        {/* URL + Auth for custom webhooks only */}
        {fTemplate==='custom'&&(<>
          <div style={{marginBottom:12}}><label style={{fontSize:12,fontWeight:600,color:"#374151",display:"block",marginBottom:4}}>Webhook URL</label><input value={fUrl} onChange={e=>setFUrl(e.target.value)} placeholder="https://..." style={{width:"100%",padding:"8px 12px",border:"1px solid #e5e7eb",borderRadius:8,fontSize:13,boxSizing:"border-box"}}/></div>
          <div style={{marginBottom:12}}><label style={{fontSize:12,fontWeight:600,color:"#374151",display:"block",marginBottom:4}}>Auth Header <span style={{fontWeight:400,color:"#9ca3af"}}>(optional)</span></label><input value={fAuth} onChange={e=>setFAuth(e.target.value)} placeholder="Authorization: Bearer your-token" style={{width:"100%",padding:"8px 12px",border:"1px solid #e5e7eb",borderRadius:8,fontSize:13,boxSizing:"border-box"}}/></div>
        </>)}

        <div style={{marginBottom:12}}><label style={{fontSize:12,fontWeight:600,color:"#374151",marginBottom:6,display:"block"}}>Triggers</label><div style={{display:"flex",flexWrap:"wrap",gap:6}}>{triggersList.map(t=>{const sel=fTriggers.includes(t);return <button key={t} type="button" onClick={()=>setFTriggers(sel?fTriggers.filter(x=>x!==t):[...fTriggers,t])} style={{padding:"4px 12px",borderRadius:6,fontSize:11,fontWeight:600,border:"1px solid",cursor:"pointer",background:sel?"#0044cc14":"#fff",color:sel?"#0052e0":"#6b7280",borderColor:sel?"#0044cc30":"#e2e5ea"}}>{TL[t]||t}</button>;})}</div></div>
        <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}><button onClick={closeForm} style={{padding:"8px 20px",borderRadius:8,border:"1px solid #e5e7eb",background:"#fff",cursor:"pointer",fontSize:13}}>Cancel</button><button onClick={save} disabled={!fName} style={{padding:"8px 20px",borderRadius:8,border:"none",background:"#0052e0",color:"#fff",cursor:"pointer",fontSize:13,fontWeight:600,opacity:!fName?0.5:1}}>{editId?"Update":"Save"}</button></div>
      </div>)}
      <div className="aihub_card"><DataTable columns={[
        {label:"Webhook",render:r=><div><div style={{display:"flex",alignItems:"center",gap:6}}><span style={{fontSize:16}}>{TI[r.template]||"⚡"}</span><div className="aihub_text_primary">{r.name}</div></div><div className="aihub_text_muted" style={{fontSize:11}}>{r.url?.slice(0,50)}{r.url?.length>50?"...":""}</div></div>},
        {label:"Template",render:r=><Tag text={templates?.[r.template]?.name||r.template}/>},
        {label:"Triggers",render:r=><div style={{display:"flex",flexWrap:"wrap",gap:3}}>{(r.triggers||[]).map(t=><Tag key={t} text={TL[t]||t} color="#6366f1"/>)}</div>},
        {label:"Status",render:r=><Badge text={r.enabled?"Active":"Disabled"} color={r.enabled?"#22c55e":"#9ca3af"}/>},
        {label:"Actions",render:r=><div style={{display:"flex",gap:6,whiteSpace:"nowrap"}}><button onClick={()=>startEdit(r)} style={{background:"none",border:"none",cursor:"pointer",color:"#0052e0",fontSize:12,fontWeight:600}}>Edit</button><button onClick={()=>test(r.id)} disabled={testing===r.id} style={{background:"none",border:"none",cursor:"pointer",color:"#6366f1",fontSize:12,fontWeight:600}}>{testing===r.id?"Testing...":"Test"}</button><button onClick={()=>toggle(r)} style={{background:"none",border:"none",cursor:"pointer",color:"#f59e0b",fontSize:12,fontWeight:600}}>{r.enabled?"Disable":"Enable"}</button><button onClick={()=>remove(r.id)} style={{background:"none",border:"none",cursor:"pointer",color:"#ef4444",fontSize:12,fontWeight:600}}>Delete</button></div>},
      ]} rows={hooks} empty="No webhooks configured. Click 'Add Webhook' to connect to Slack, Teams, Jira, or any tool."/></div>
    </div>)}

    {tab==="log"&&(<div className="aihub_card"><DataTable columns={[
      {label:"Time",render:r=>relTime(r.timestamp)},
      {label:"Webhook",render:r=><div className="aihub_text_primary">{r.webhook_name||"—"}</div>},
      {label:"Trigger",render:r=><Tag text={TL[r.trigger]||r.trigger}/>},
      {label:"Status",render:r=><Badge text={r.status} color={r.status==='delivered'?"#22c55e":r.status==='failed'?"#f59e0b":"#ef4444"}/>},
      {label:"HTTP",render:r=>r.http_status||"—"},
      {label:"Error",render:r=><div className="aihub_text_muted" style={{fontSize:11,maxWidth:200,overflow:"hidden",textOverflow:"ellipsis"}}>{r.error||"—"}</div>},
    ]} rows={deliveryLog||[]} empty="No webhook deliveries yet."/></div>)}
  </div>);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 10. POLICY PACKS — pre-built compliance bundles (GDPR, HIPAA, SOC 2, ...).
//     Deploying a pack materialises its agent rules as ordinary policies, so they
//     are evaluated by the existing engine. DLP and attestation rules are shown
//     distinctly because they are NOT auto-enforced — pretending otherwise is what
//     fails an audit.
// ═══════════════════════════════════════════════════════════════════════════════
const PACK_API = "/api";   // governance routes live under /api, not /api/v1

async function packFetch(path, opts) {
  const r = await fetch(`${PACK_API}${path}`, opts);
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error || `${r.status}`);
  return body;
}

const ENFORCE_META = {
  agent:       { label:"Enforced",   color:"#16a34a", hint:"Evaluated automatically against discovered AI agents." },
  dlp:         { label:"Monitored",  color:"#0052e0", hint:"Detected in prompts by the endpoint agent / extension. Coverage is verified against observed events, not toggled from here." },
  attestation: { label:"Attestation",color:"#b45309", hint:"A control software cannot decide — record who owns it and the evidence." },
};

function PolicyPacksView() {
  const [packs,setPacks]=useState(null),[err,setErr]=useState(null);
  const [openId,setOpenId]=useState(null),[detail,setDetail]=useState(null),[busy,setBusy]=useState(false);
  const [simId,setSimId]=useState(null);

  const loadPacks = () => packFetch("/policy-packs").then(d=>setPacks(d)).catch(e=>setErr(e.message));
  useEffect(()=>{loadPacks()},[]);

  const openPack = async (id) => {
    setOpenId(id); setDetail(null);
    try { setDetail(await packFetch(`/policy-packs/${id}`)); } catch(e){ setErr(e.message); }
  };

  const act = async (fn) => {
    setBusy(true);
    try { await fn(); await loadPacks(); if(openId) setDetail(await packFetch(`/policy-packs/${openId}`)); }
    catch(e){ setErr(e.message); }
    finally { setBusy(false); }
  };

  const deploy   = (id) => act(()=>packFetch(`/policy-packs/${id}/deploy`,{method:"POST",headers:{"content-type":"application/json"},body:"{}"}));
  const undeploy = (id) => act(()=>packFetch(`/policy-packs/${id}/undeploy`,{method:"POST",headers:{"content-type":"application/json"},body:"{}"}));
  const accept   = (id) => act(()=>packFetch(`/policy-packs/${id}/accept-version`,{method:"POST",headers:{"content-type":"application/json"},body:"{}"}));
  const toggle   = (id,key,enabled) => act(()=>packFetch(`/policy-packs/${id}/rules/${key}`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({enabled})}));
  const tune     = (id,key,v) => act(()=>packFetch(`/policy-packs/${id}/rules/${key}`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({tuned_value:Number(v)})}));
  const attest   = (id,key,owner) => act(()=>packFetch(`/policy-packs/${id}/attestations/${key}`,{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({status:"attested",owner})}));
  const unattest = (id,key) => act(()=>packFetch(`/policy-packs/${id}/attestations/${key}`,{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({status:null})}));

  if(err) return <Err msg={err}/>;
  if(!packs) return <Loading/>;

  const list = packs.packs || [];
  const simPack = list.find(p=>p.id===simId) || null;
  const deployedCount = list.filter(p=>p.deployed).length;
  const totalRules = list.reduce((a,p)=>a+p.ruleCount,0);
  const liveRules = list.filter(p=>p.deployed).reduce((a,p)=>a+p.enforceable,0);

  return (<div>
    <SectionHeader title="Compliance Policy Packs" hint="Ready-made rule bundles per framework. Deploying a pack creates real policies evaluated by the policy engine; rules that depend on prompt detection or human sign-off are labelled separately so coverage is never overstated. Use Simulate on any pack to see what it would have blocked before you deploy it."/>

    {!!(packs.definition_problems||[]).length &&
      <div className="aihub_error" style={{marginBottom:12}}>
        <AlertTriangle size={14}/> Pack definition problems: {packs.definition_problems.join("; ")}
      </div>}

    <div className="aihub_stat_grid">
      <StatCard icon={<Shield size={18}/>} label="Frameworks" value={list.length} color="#0052e0"/>
      <StatCard icon={<Wrench size={18}/>} label="Deployed" value={deployedCount} hint={`of ${list.length}`} color="#22c55e"/>
      <StatCard icon={<FileText size={18}/>} label="Total rules" value={totalRules} hint="across all packs" color="#8b5cf6"/>
      <StatCard icon={<Activity size={18}/>} label="Live enforced rules" value={liveRules} hint="evaluated automatically" color="#f59e0b"/>
    </div>

    <SectionHeader title="Frameworks"/>
    <div className="aihub_card" style={{marginBottom:18}}>
      <DataTable columns={[
        {label:"Framework",render:p=><><div className="aihub_text_primary">{p.framework}</div><div className="aihub_text_muted">{p.name}</div></>},
        {label:"Rules",render:p=>p.ruleCount,right:true},
        {label:"Enforced",render:p=><span style={{color:ENFORCE_META.agent.color,fontWeight:600}}>{p.enforceable}</span>,right:true},
        {label:"Monitored",render:p=><span style={{color:ENFORCE_META.dlp.color,fontWeight:600}}>{p.monitored}</span>,right:true},
        {label:"Attestations",render:p=><span style={{color:ENFORCE_META.attestation.color,fontWeight:600}}>{p.attestations}</span>,right:true},
        {label:"Status",render:p=>p.deployed
          ? <span style={{color:"#16a34a",fontWeight:600,fontSize:11}}>deployed v{p.deployed_version}{p.update_available&&" · update available"}</span>
          : <span className="aihub_text_muted" style={{fontSize:11}}>not deployed</span>},
        {label:"Actions",render:p=><div style={{display:"flex",gap:6,justifyContent:"flex-end"}}>
          <button className="aihub_filter_btn" disabled={busy} onClick={()=>openPack(p.id)}>Review</button>
          <button className="aihub_filter_btn" disabled={busy||p.monitored===0}
                  title={p.monitored===0
                    ? "This pack has no prompt-detection rules, so there is nothing to simulate."
                    : "See what this pack would have blocked, before deploying it."}
                  onClick={()=>setSimId(simId===p.id?null:p.id)}>Simulate</button>
          {p.deployed
            ? <>{p.update_available && <button className="aihub_action_btn warn" disabled={busy} onClick={()=>accept(p.id)}>Accept v{p.version}</button>}
                <button className="aihub_action_btn danger" disabled={busy} onClick={()=>undeploy(p.id)}>Undeploy</button></>
            : <button className="aihub_action_btn" disabled={busy} onClick={()=>deploy(p.id)}>Deploy</button>}
        </div>,right:true},
      ]} rows={list} empty="No policy packs available."/>
    </div>

    {/* Simulate Modal */}
    {simPack && (
      <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center"}} onClick={()=>setSimId(null)}>
        <div style={{background:"#fff",borderRadius:14,padding:28,width:800,maxHeight:"85vh",overflowY:"auto",boxShadow:"0 20px 60px rgba(0,0,0,0.2)"}} onClick={e=>e.stopPropagation()}>
          <PackSimulation pack={simPack} onClose={()=>setSimId(null)}/>
        </div>
      </div>
    )}

    {/* Review Modal */}
    {openId && (!detail ? <Loading/> : (
      <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center"}} onClick={()=>{setOpenId(null);setDetail(null);}}>
        <div style={{background:"#fff",borderRadius:14,padding:28,width:900,maxHeight:"85vh",overflowY:"auto",boxShadow:"0 20px 60px rgba(0,0,0,0.2)"}} onClick={e=>e.stopPropagation()}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:16}}>
            <div>
              <h3 style={{margin:"0 0 4px",fontSize:18,fontWeight:700}}>{detail.framework} — {detail.ruleCount} rules</h3>
              <div className="aihub_text_muted">{detail.description}</div>
            </div>
            <div style={{display:"flex",gap:6}}>
              {detail.monitored>0 && <button className="aihub_filter_btn" onClick={()=>setSimId(simId===detail.id?null:detail.id)}>
                {simId===detail.id?"Hide simulation":"Run simulation"}
              </button>}
              <button onClick={()=>{setOpenId(null);setDetail(null);}} style={{background:"none",border:"none",cursor:"pointer",fontSize:20,color:"#6b7280"}}>✕</button>
            </div>
          </div>

          <div style={{display:"flex",gap:14,flexWrap:"wrap",marginBottom:12,fontSize:11}}>
            {Object.entries(ENFORCE_META).map(([k,m])=>(
              <span key={k} style={{color:m.color}}>
                <strong>{m.label}</strong> — {m.hint}
              </span>
            ))}
          </div>

          <DataTable columns={[
            {label:"Rule",render:r=><>
              <div className="aihub_text_primary">{r.title}</div>
              <div className="aihub_text_muted">{r.citation}</div>
            </>},
            {label:"Type",render:r=><span style={{color:ENFORCE_META[r.enforcement].color,fontWeight:600,fontSize:11}}>{ENFORCE_META[r.enforcement].label}</span>},
            {label:"Severity",render:r=><Badge text={r.severity} color={{critical:"#dc2626",high:"#ea580c",medium:"#d97706",low:"#65a30d"}[r.severity]||"#9ca3af"}/>},
            {label:"State",render:r=>{
              if(r.enforcement==="agent") return <span style={{fontSize:11,color:r.enabled?"#16a34a":"#9ca3af"}}>{r.enabled?"active":"disabled"}</span>;
              if(r.enforcement==="dlp") return r.coverage_verified
                ? <span style={{fontSize:11,color:"#16a34a"}}>patterns seen</span>
                : <span style={{fontSize:11,color:"#b45309"}}>no events yet</span>;
              return r.attestation
                ? <span style={{fontSize:11,color:"#16a34a"}}>attested — {r.attestation.owner}</span>
                : <span style={{fontSize:11,color:"#b45309"}}>outstanding</span>;
            }},
            {label:"",render:r=>{
              if(!detail.deployed) return <span className="aihub_text_muted" style={{fontSize:11}}>deploy first</span>;
              if(r.enforcement==="agent") return <div style={{display:"flex",gap:6,alignItems:"center"}}>
                <button className="aihub_filter_btn" disabled={busy} onClick={()=>toggle(detail.id,r.key,!r.enabled)}>{r.enabled?"Disable":"Enable"}</button>
                {r.tunable && <input type="number" defaultValue={r.tuned_value ?? r.conditions?.[0]?.value}
                  min={r.tunable.min} max={r.tunable.max} title={r.tunable.label} disabled={busy}
                  style={{width:70,padding:"3px 6px",fontSize:12,border:"1px solid #e5e7eb",borderRadius:4}}
                  onBlur={e=>{const v=e.target.value; if(v!=="") tune(detail.id,r.key,v);}}/>}
              </div>;
              if(r.enforcement==="attestation") return r.attestation
                ? <button className="aihub_filter_btn" disabled={busy} onClick={()=>unattest(detail.id,r.key)}>Clear</button>
                : <button className="aihub_action_btn warn" disabled={busy} onClick={()=>{
                    const owner=window.prompt(`Who is accountable for this control?\n\n${r.evidence||""}`);
                    if(owner) attest(detail.id,r.key,owner);
                  }}>Attest</button>;
              return <span className="aihub_text_muted" style={{fontSize:11}}>{(r.patterns||[]).length} patterns</span>;
            }},
          ]} rows={detail.rules||[]} empty="No rules in this pack."/>

          <p className="aihub_text_muted" style={{fontSize:11,marginTop:8}}>
            Deploying creates {detail.enforceable} policies that the engine evaluates on every agent scan. The
            {" "}{detail.monitored} monitored rules rely on prompt detection already running on enrolled endpoints —
            their coverage is confirmed from observed events. The {detail.attestations} attestations require a named
            owner and are never satisfied automatically.
          </p>
        </div>
      </div>
    ))}
  </div>);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 11. PACK IMPACT SIMULATION — "what if" mode, scoped to one policy pack and shown
//     alongside Review so the impact is visible BEFORE the pack is deployed.
//     Nothing is enabled by simulating; the payload carries applied:false and the
//     UI says so, because a simulation must never read as a deployment.
// ═══════════════════════════════════════════════════════════════════════════════
// Sub-panels inside the simulation card — a nested .aihub_card would double the
// border and padding, so these are flat bordered blocks instead.
const SIM_PANEL={border:"1px solid #e5e7eb",borderRadius:8,padding:"12px 14px",background:"#fff"};

function PackSimulation({ pack, onClose }) {
  const [opts,setOpts]=useState(null),[err,setErr]=useState(null);
  const [days,setDays]=useState(30);
  const [excl,setExcl]=useState([]);
  const [samples,setSamples]=useState(false);
  const [result,setResult]=useState(null),[busy,setBusy]=useState(false);

  // Refetch options when the window changes — the tool list is window-scoped, so a
  // stale list would offer exclusions that match nothing in the new window.
  useEffect(()=>{
    packFetch(`/policy-simulator/options?days=${days}`).then(setOpts).catch(e=>setErr(e.message));
  },[days]);

  const run = async () => {
    setBusy(true); setErr(null);
    try {
      setResult(await packFetch("/policy-simulator/simulate",{
        method:"POST", headers:{"content-type":"application/json"},
        body:JSON.stringify({ days, pack_id:pack.id, include_samples:samples, rule:{ exclude_services:excl } }),
      }));
    } catch(e){ setErr(e.message); setResult(null); }
    finally { setBusy(false); }
  };

  // Auto-run once on open, and again whenever the window changes — opening a
  // simulation panel with empty stat cards reads as "no impact", which is wrong.
  // A pack with no detection rules has nothing to simulate: the API would reject
  // an empty pattern set, so show the explanation instead of an error banner.
  useEffect(()=>{ if(opts && pack.monitored>0) run(); },[opts]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleExcl = (v) => setExcl(a=>a.includes(v)?a.filter(x=>x!==v):[...a,v]);
  const impactColor = {low:"#16a34a",medium:"#b45309",high:"#b91c1c"};

  return (<div className="aihub_card" style={{marginBottom:18,borderLeft:"3px solid #0044cc"}}>
    <SectionHeader
      title={`Simulation — ${pack.framework}`}
      hint={pack.deployed
        ? "This pack is already deployed. The figures below show what its detection patterns match in real history."
        : "What this pack's detection patterns would have matched, from real captured prompts. Nothing is enabled by running this."}
      action={<button className="aihub_filter_btn" onClick={onClose}><X size={13}/> Close</button>}
    />

    {err && <div className="aihub_error" style={{marginBottom:12}}><AlertTriangle size={14}/> {err}</div>}

    {pack.monitored===0
      ? <p className="aihub_text_muted" style={{fontSize:12,margin:0}}>
          This pack has no prompt-detection rules, so there is nothing to simulate. Its controls are agent
          policies and attestations, which are evaluated against the agent registry rather than prompt history.
        </p>
      : <>
        <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:10,flexWrap:"wrap"}}>
          <span style={{fontSize:12,fontWeight:600}}>Window</span>
          {[7,30,90].map(d=>(
            <button key={d} className={`aihub_filter_btn ${days===d?"active":""}`} disabled={busy} onClick={()=>setDays(d)}>{d} days</button>
          ))}
          {opts && <span className="aihub_text_muted" style={{fontSize:11}}>{opts.events_available} prompt events captured in this window</span>}
        </div>

        {!!opts?.services?.length && <div style={{marginBottom:12}}>
          <div style={{fontSize:12,fontWeight:600,marginBottom:5}}>Allow these tools (exclude from blocking)</div>
          <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
            {opts.services.slice(0,10).map(s=>(
              <button key={s.value} className={`aihub_filter_btn ${excl.includes(s.value)?"active":""}`}
                      disabled={busy} onClick={()=>toggleExcl(s.value)}>{s.value} · {s.events}</button>
            ))}
          </div>
          <div className="aihub_text_muted" style={{fontSize:11,marginTop:4}}>
            Use this to keep an approved internal tool working while blocking the same data elsewhere.
          </div>
        </div>}

        <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap",marginBottom:result?14:0}}>
          <button className="aihub_action_btn" disabled={busy||!opts} onClick={run}>
            {busy?"Simulating…":"Re-run simulation"}
          </button>
          <label style={{fontSize:12,display:"flex",alignItems:"center",gap:5}}>
            <input type="checkbox" checked={samples} disabled={busy} onChange={e=>setSamples(e.target.checked)}/>
            Include example prompts (masked)
          </label>
        </div>
      </>}

    {result && <>
      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12,padding:"7px 12px",borderRadius:6,
                   background:"#f0fdf4",border:"1px solid #bbf7d0",fontSize:12,color:"#166534"}}>
        <Shield size={13}/>
        <span><strong>Simulation only — nothing was enabled.</strong> {result.rule_label}, {result.window_days} days.</span>
      </div>

      <div className="aihub_stat_grid">
        <StatCard icon={<AlertTriangle size={18}/>} label="Would be blocked" value={(result.would_block_total||0).toLocaleString()} hint={`of ${(result.events_in_scope||0).toLocaleString()} in scope`} color="#b91c1c"/>
        <StatCard icon={<MessageSquare size={18}/>} label="People impacted" value={result.unique_users_impacted} color="#8b5cf6"/>
        <StatCard icon={<Activity size={18}/>} label="Interruptions / person / day" value={result.productivity.blocks_per_user_per_day} hint={`${result.productivity.impact_level} impact`} color={impactColor[result.productivity.impact_level]||"#f59e0b"}/>
        <StatCard icon={<Wrench size={18}/>} label="vs enforcement today" value={result.comparison.delta_percent!=null?`${result.comparison.delta_percent>0?"+":""}${result.comparison.delta_percent}%`:"—"} hint={`now ${result.comparison.current_enforcement_events}`} color="#0052e0"/>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,marginBottom:14}}>
        <div style={SIM_PANEL}>
          <SectionHeader title="By AI tool"/>
          <DataTable columns={[{label:"Tool",key:"service"},{label:"Would block",key:"blocks",right:true}]}
                     rows={result.by_service} empty="Nothing would be blocked."/>
        </div>
        <div style={SIM_PANEL}>
          <SectionHeader title="By data category"/>
          <DataTable columns={[{label:"Category",key:"category"},{label:"Would block",key:"blocks",right:true}]}
                     rows={result.by_category} empty="Nothing would be blocked."/>
        </div>
      </div>

      <div style={{...SIM_PANEL,marginBottom:14}}>
        <SectionHeader title="Highest impact people" hint={result.productivity.summary}/>
        <DataTable columns={[
          {label:"Person",render:r=><><div className="aihub_text_primary">{r.user}</div>{!r.attributed&&<div className="aihub_text_muted">unattributed install, not a confirmed person</div>}</>},
          {label:"Would block",key:"blocks",right:true},
          {label:"Per day",key:"per_day",right:true},
        ]} rows={result.top_users} empty="Nobody would be affected."/>
      </div>

      {!!result.samples?.length && <div style={{...SIM_PANEL,marginBottom:14}}>
        <SectionHeader title="Example prompts that would have been blocked" hint="Detected secrets and identifiers are masked before display — the excerpt shows the context, never the sensitive value."/>
        <DataTable columns={[
          {label:"When",render:r=>relTime(r.occurred_at)},
          {label:"Tool",key:"ai_service"},
          {label:"Detected",render:r=>(r.patterns||[]).join(", ")},
          {label:"Excerpt",render:r=>r.excerpt_available?<span style={{fontSize:11}}>{r.excerpt}</span>:<span className="aihub_text_muted">no text retained</span>},
        ]} rows={result.samples} empty="No excerpts available."/>
      </div>}

      <div style={SIM_PANEL}>
        <SectionHeader title={pack.deployed?"Worth knowing":"Before you deploy"}/>
        <ul style={{margin:0,paddingLeft:18,fontSize:12,color:"#4b5563"}}>
          {result.caveats.map((c,i)=><li key={i} style={{marginBottom:3}}>{c}</li>)}
        </ul>
      </div>
    </>}
  </div>);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 12. EU AI ACT — classification wizard, FRIA, and the audit-ready report.
//     The wizard PROPOSES a tier; a named officer confirms or overrides it with a
//     written justification. That record is what an auditor asks for.
// ═══════════════════════════════════════════════════════════════════════════════
const TIER_COLOR={unacceptable:"#b91c1c",high:"#c2410c",limited:"#b45309",minimal:"#15803d"};

function EuAiActView() {
  const [meta,setMeta]=useState(null),[list,setList]=useState(null),[err,setErr]=useState(null);
  const [mode,setMode]=useState("portfolio");     // portfolio | wizard | fria
  const [sysName,setSysName]=useState(""),[sysId,setSysId]=useState("");
  const [answers,setAnswers]=useState({}),[live,setLive]=useState(null);
  const [officer,setOfficer]=useState(""),[busy,setBusy]=useState(false);
  const [ovTier,setOvTier]=useState(""),[ovWhy,setOvWhy]=useState("");
  const [friaFor,setFriaFor]=useState(null),[friaAns,setFriaAns]=useState({});

  const reload = () => packFetch("/eu-ai-act/assessments").then(setList).catch(e=>setErr(e.message));
  useEffect(()=>{ packFetch("/eu-ai-act/questionnaire").then(setMeta).catch(e=>setErr(e.message)); reload(); },[]);

  // Re-score as the user answers, so the outcome is never a surprise at the end.
  useEffect(()=>{
    if(mode!=="wizard") return;
    packFetch("/eu-ai-act/classify",{method:"POST",headers:{"content-type":"application/json"},
      body:JSON.stringify({answers})}).then(setLive).catch(()=>{});
  },[answers,mode]);

  const setAns=(id,v)=>setAnswers(a=>({...a,[id]:v}));

  const save = async () => {
    setBusy(true); setErr(null);
    try {
      const id = sysId || sysName.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");
      await packFetch(`/eu-ai-act/assessments/${encodeURIComponent(id)}`,{
        method:"PUT",headers:{"content-type":"application/json"},
        body:JSON.stringify({system_name:sysName,answers,assessed_by:officer,
          ...(ovTier?{override_tier:ovTier,override_justification:ovWhy}:{})}),
      });
      setMode("portfolio"); setAnswers({}); setSysName(""); setSysId(""); setOvTier(""); setOvWhy(""); setLive(null);
      await reload();
    } catch(e){ setErr(e.message); } finally { setBusy(false); }
  };

  const saveFria = async () => {
    setBusy(true); setErr(null);
    try {
      await packFetch(`/eu-ai-act/assessments/${encodeURIComponent(friaFor.system_id)}/fria`,{
        method:"PUT",headers:{"content-type":"application/json"},
        body:JSON.stringify({fria_answers:friaAns,completed_by:officer||friaFor.assessed_by}),
      });
      setMode("portfolio"); setFriaFor(null); setFriaAns({});
      await reload();
    } catch(e){ setErr(e.message); } finally { setBusy(false); }
  };

  const del = async (id) => { try{ await packFetch(`/eu-ai-act/assessments/${encodeURIComponent(id)}`,{method:"DELETE"}); await reload(); }catch(e){ setErr(e.message); } };

  if(err && !meta) return <Err msg={err}/>;
  if(!meta || !list) return <Loading/>;

  const s = list.summary;
  const reportUrl = `${PACK_API}/eu-ai-act/report?format=html&org=${encodeURIComponent("CloudFuze")}&officer=${encodeURIComponent(officer||"—")}`;

  return (<div>
    <SectionHeader title="EU AI Act — Assessment & Reporting" hint="Classify each AI system into the Act's four risk tiers, complete a Fundamental Rights Impact Assessment where Article 27 requires one, and export an audit-ready report. The wizard proposes a tier; a named officer confirms or overrides it with a written reason."/>

    {err && <div className="aihub_error" style={{marginBottom:12}}><AlertTriangle size={14}/> {err}</div>}

    <div className="aihub_stat_grid">
      <StatCard icon={<FileText size={18}/>} label="Systems classified" value={s.total_assessed} color="#0052e0"/>
      <StatCard icon={<AlertTriangle size={18}/>} label="Prohibited in use" value={s.prohibited_in_use} hint={s.prohibited_in_use?"must not be deployed":"none"} color={s.prohibited_in_use?"#b91c1c":"#16a34a"}/>
      <StatCard icon={<Shield size={18}/>} label="High risk" value={s.by_tier.high} hint="full obligations" color="#c2410c"/>
      <StatCard icon={<Clock size={18}/>} label="FRIAs complete" value={`${s.fria_complete}/${s.fria_required}`} hint="Article 27" color="#8b5cf6"/>
    </div>

    <div style={{display:"flex",gap:8,marginBottom:14,flexWrap:"wrap",alignItems:"center"}}>
      <button className={`aihub_filter_btn ${mode==="portfolio"?"active":""}`} onClick={()=>setMode("portfolio")}>Portfolio</button>
      <button className="aihub_action_btn" onClick={()=>{setMode("wizard");setAnswers({});setLive(null);}}><Plus size={13}/> Classify a system</button>
      <a className="aihub_filter_btn" href={reportUrl} target="_blank" rel="noreferrer" style={{textDecoration:"none"}}>Open compliance report</a>
      <input placeholder="Your name (compliance officer)" value={officer} onChange={e=>setOfficer(e.target.value)}
             style={{padding:"5px 10px",fontSize:12,border:"1px solid #e5e7eb",borderRadius:6,minWidth:210}}/>
    </div>

    {mode==="portfolio" && <div className="aihub_card">
      <SectionHeader title="Assessed AI systems"/>
      <DataTable columns={[
        {label:"System",render:r=><><div className="aihub_text_primary">{r.system_name}</div><div className="aihub_text_muted">{r.assessed_by}</div></>},
        {label:"Risk tier",render:r=><Badge text={r.final_tier} color={TIER_COLOR[r.final_tier]||"#6b7280"}/>},
        {label:"Basis",render:r=>r.overridden
          ? <span style={{fontSize:11,color:"#b45309"}}>overridden from {r.proposed_tier}</span>
          : <span style={{fontSize:11}}>{(r.proposed_reasons||[]).map(x=>x.citation).join(", ")||"no triggers"}</span>},
        {label:"FRIA",render:r=>!r.fria_required
          ? <span className="aihub_text_muted" style={{fontSize:11}}>not required</span>
          : <span style={{fontSize:11,color:r.fria_completeness?.complete?"#16a34a":"#b45309"}}>
              {r.fria_completeness?.answered||0}/{r.fria_completeness?.total||10} sections</span>},
        {label:"Actions",render:r=><div style={{display:"flex",gap:6,justifyContent:"flex-end"}}>
          {r.fria_required && <button className="aihub_action_btn warn" onClick={()=>{setFriaFor(r);setFriaAns(r.fria_answers||{});setMode("fria");}}>FRIA</button>}
          <button className="aihub_action_btn danger" onClick={()=>del(r.system_id)}><Trash2 size={12}/></button>
        </div>,right:true},
      ]} rows={list.assessments} empty="No systems classified yet. Use “Classify a system” to start."/>
    </div>}

    {mode==="wizard" && <div className="aihub_card">
      <SectionHeader title="Risk tier classification"
        hint="Answer only what applies. Prohibited practices take precedence over everything else — the Act's bans are absolute, so a later answer cannot soften them."
        action={<button className="aihub_filter_btn" onClick={()=>setMode("portfolio")}><X size={13}/> Cancel</button>}/>

      <input placeholder="AI system name (e.g. HR CV Screener)" value={sysName} onChange={e=>setSysName(e.target.value)}
             style={{padding:"7px 11px",fontSize:13,border:"1px solid #e5e7eb",borderRadius:6,width:"100%",maxWidth:460,marginBottom:14}}/>

      {["prohibited","high_risk","transparency","context"].map(sec=>{
        const qs=meta.tier_questions.filter(q=>q.section===sec);
        const title={prohibited:"1. Prohibited practices (Article 5)",high_risk:"2. High-risk use cases (Annex III)",
                     transparency:"3. Transparency obligations (Article 50)",context:"4. Your role and context"}[sec];
        return (<div key={sec} style={{marginBottom:16}}>
          <div style={{fontSize:12,fontWeight:700,color:"#0052e0",marginBottom:6}}>{title}</div>
          {qs.map(q=>(
            <div key={q.id} style={{padding:"8px 0",borderBottom:"1px solid #f1f5f9"}}>
              <div style={{fontSize:12.5,marginBottom:3}}>{q.question}</div>
              <div className="aihub_text_muted" style={{fontSize:11,marginBottom:5}}>{q.help} · <Mono>{q.citation}</Mono></div>
              <div style={{display:"flex",gap:6}}>
                <button className={`aihub_filter_btn ${answers[q.id]===true?"active":""}`} onClick={()=>setAns(q.id,true)}>Yes</button>
                <button className={`aihub_filter_btn ${answers[q.id]===false?"active":""}`} onClick={()=>setAns(q.id,false)}>No</button>
              </div>
            </div>
          ))}
        </div>);
      })}

      {live && <div style={{padding:"12px 14px",borderRadius:6,marginBottom:12,
                            background:"#f8fafc",border:`2px solid ${TIER_COLOR[live.tier]}`}}>
        <div style={{fontSize:13,fontWeight:700,color:TIER_COLOR[live.tier]}}>Proposed: {live.tier_meta.label}</div>
        <div style={{fontSize:12,margin:"4px 0 6px"}}>{live.tier_meta.summary}</div>
        {!!live.reasons.length && <div style={{fontSize:11,color:"#4b5563"}}>Because: {live.reasons.map(r=>r.citation).join(", ")}</div>}
        {live.fria_required && <div style={{fontSize:11,color:"#b45309",marginTop:4}}><strong>A FRIA is required</strong> (Article 27) — you indicated a public body or essential-service operator.</div>}
        <div style={{fontSize:11,marginTop:8}}><strong>Obligations if confirmed:</strong></div>
        <ul style={{margin:"3px 0 0 16px",fontSize:11,color:"#4b5563"}}>
          {live.tier_meta.obligations.map((o,i)=><li key={i}>{o}</li>)}
        </ul>
      </div>}

      <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap",marginBottom:10}}>
        <span style={{fontSize:12,fontWeight:600}}>Override tier (optional)</span>
        {["","unacceptable","high","limited","minimal"].map(t=>(
          <button key={t||"none"} className={`aihub_filter_btn ${ovTier===t?"active":""}`} onClick={()=>setOvTier(t)}>{t||"no override"}</button>
        ))}
      </div>
      {ovTier && <input placeholder="Why are you overriding the proposed tier? (required, recorded in the report)"
              value={ovWhy} onChange={e=>setOvWhy(e.target.value)}
              style={{padding:"7px 11px",fontSize:12,border:"1px solid #e5e7eb",borderRadius:6,width:"100%",marginBottom:10}}/>}

      <button className="aihub_action_btn" disabled={busy||!sysName||!officer||(!!ovTier&&!ovWhy)} onClick={save}>
        {busy?"Saving…":"Save classification"}
      </button>
      {(!sysName||!officer) && <div className="aihub_text_muted" style={{fontSize:11,marginTop:5}}>
        A system name and your name are required — an assessment needs an accountable person.
      </div>}
    </div>}

    {mode==="fria" && friaFor && <div className="aihub_card">
      <SectionHeader title={`FRIA — ${friaFor.system_name}`}
        hint="Fundamental Rights Impact Assessment under Article 27. Required before first use of a high-risk system by a public body or essential-service operator."
        action={<button className="aihub_filter_btn" onClick={()=>setMode("portfolio")}><X size={13}/> Cancel</button>}/>
      {meta.fria_questions.map(q=>(
        <div key={q.id} style={{marginBottom:12}}>
          <div style={{fontSize:12.5,fontWeight:600}}>{q.prompt}</div>
          <div className="aihub_text_muted" style={{fontSize:11,marginBottom:4}}>{q.help} · <Mono>{q.citation}</Mono></div>
          <textarea rows={q.kind==="list"?2:3} value={friaAns[q.id]||""}
                    onChange={e=>setFriaAns(a=>({...a,[q.id]:e.target.value}))}
                    style={{width:"100%",padding:"7px 10px",fontSize:12,border:"1px solid #e5e7eb",
                            borderRadius:6,fontFamily:"inherit",resize:"vertical"}}/>
        </div>
      ))}
      <button className="aihub_action_btn" disabled={busy} onClick={saveFria}>{busy?"Saving…":"Save FRIA"}</button>
      <div className="aihub_text_muted" style={{fontSize:11,marginTop:5}}>
        Saved progress is kept. Sections shorter than ten characters count as outstanding, and the report lists them.
      </div>
    </div>}
  </div>);
}

// ServerMonitorView below arrived from main while this branch was in flight.
// It is kept as-is; only the flat PAGES map that followed it was replaced by
// the TAB_GROUPS structure further down. ServerMonitor stays reachable by URL
// (its route is commented out in App.jsx, exactly as it was upstream).
function ServerMonitorView() {
  const [tab, setTab] = useState("traces");
  const [stats, setStats] = useState(null);
  const [servers, setServers] = useState([]);
  const [traces, setTraces] = useState([]);
  const [governed, setGoverned] = useState([]);
  const [selectedServer, setSelectedServer] = useState(null);
  const [selectedAgent, setSelectedAgent] = useState(null);
  const [agentCalls, setAgentCalls] = useState([]);
  const [selectedTrace, setSelectedTrace] = useState(null);
  const [traceDetail, setTraceDetail] = useState(null);
  const [installCmd, setInstallCmd] = useState("");
  const [proxyPort, setProxyPort] = useState("8443");
  const [serverIp, setServerIp] = useState("");
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);

  const fetchAll = async (silent) => {
    try {
      const [s, srv, t, g] = await Promise.all([
        apiFetch("/traces/stats"),
        apiFetch("/monitor/servers"),
        apiFetch("/traces?limit=50"),
        apiFetch("/monitor/governed").catch(() => []),
      ]);
      setStats(s); setServers(srv); setTraces(t); setGoverned(g);
    } catch (e) { if (!silent) console.error(e); }
    setLoading(false);
  };

  useEffect(() => { fetchAll(); }, []);

  // Auto-refresh every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => fetchAll(true), 30000);
    return () => clearInterval(interval);
  }, []);

  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const fetchAgentCalls = () => {
    if (!selectedAgent) { setAgentCalls([]); return; }
    const params = new URLSearchParams({ machineId: selectedAgent.machine_id, limit: 1000 });
    if (selectedAgent.container_ip) params.set("sourceIp", selectedAgent.container_ip);
    if (dateFrom) params.set("from", new Date(dateFrom).toISOString());
    if (dateTo) params.set("to", new Date(dateTo + "T23:59:59").toISOString());
    apiFetch("/server-agents/calls?" + params.toString())
      .then(calls => setAgentCalls(calls || []))
      .catch(() => setAgentCalls([]));
  };

  useEffect(() => { fetchAgentCalls(); }, [selectedAgent, dateFrom, dateTo]);

  // Auto-refresh agent calls every 15 seconds when viewing an agent
  useEffect(() => {
    if (!selectedAgent) return;
    const interval = setInterval(fetchAgentCalls, 15000);
    return () => clearInterval(interval);
  }, [selectedAgent]);

  useEffect(() => {
    if (!selectedTrace) { setTraceDetail(null); return; }
    apiFetch("/server-agents/calls/" + encodeURIComponent(selectedTrace)).then(setTraceDetail).catch(() => setTraceDetail(null));
  }, [selectedTrace]);

  const generateInstallCmd = async () => {
    setGenerating(true);
    try {
      // Let the server determine its own public URL (it knows its port)
      const host = window.location.hostname;
      const r = await fetch(`${API}/monitor/generate-token`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ host, port: proxyPort }),
      });
      const d = await r.json();
      setInstallCmd(d.install_command || "");
    } catch (e) { console.error(e); }
    setGenerating(false);
  };

  const copyCmd = () => {
    try {
      navigator.clipboard.writeText(installCmd);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = installCmd;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  if (loading) return <Loading />;

  const smTabs = [
    { id: "setup", label: "Setup", icon: <Plus size={14} /> },
    { id: "traces", label: "Traces", icon: <Activity size={14} /> },
    { id: "servers", label: "Servers", icon: <Server size={14} /> },
  ];

  return (
    <div>
      <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <StatCard icon={<Activity size={18} />} label="Total Calls" value={stats?.total_calls || 0} hint="All time" color="#3b82f6" />
        <StatCard icon={<Clock size={18} />} label="Last 24h" value={stats?.calls_last_24h || 0} hint="Recent calls" color="#8b5cf6" />
        <StatCard icon={<Server size={18} />} label="Servers" value={stats?.connected_servers || 0} hint="Connected" color="#22c55e" />
        <StatCard icon={<Shield size={18} />} label="Total Cost" value={fmtUsd(stats?.total_cost_usd)} hint="Recalculated live" color="#f59e0b" />
      </div>

      <div style={{ display: "flex", gap: 2, marginBottom: 16, borderBottom: "1px solid #e5e7eb", paddingBottom: 0 }}>
        {smTabs.map(t => (
          <button key={t.id} onClick={() => { setTab(t.id); setSelectedTrace(null); }}
            style={{ display: "flex", alignItems: "center", gap: 5, padding: "8px 16px", border: "none", background: "none", cursor: "pointer", fontSize: 13, fontWeight: tab === t.id ? 600 : 400, color: tab === t.id ? "#2563eb" : "#6b7280", borderBottom: tab === t.id ? "2px solid #2563eb" : "2px solid transparent", marginBottom: -1 }}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {tab === "traces" && !selectedServer && (
        <div>
          <SectionHeader title="Servers" hint="Click a server to see governed agents and their traces" />
          {servers.length === 0 ? (
            <Empty icon={<Server size={24} />} title="No servers connected" msg="Install the server monitor to start capturing AI agent traces." />
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              {servers.map(srv => {
                const srvGoverned = governed.filter(g => g.machine_id === srv.machine_id);
                return (
                  <div key={srv.machine_id} onClick={() => setSelectedServer(srv)}
                    style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: 16, cursor: "pointer", transition: "border-color 0.2s" }}
                    onMouseEnter={e => e.currentTarget.style.borderColor = "#3b82f6"}
                    onMouseLeave={e => e.currentTarget.style.borderColor = "#e2e5ea"}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <div style={{ width: 8, height: 8, borderRadius: "50%", background: srv.status === "active" ? "#22c55e" : srv.status === "uninstalled" ? "#ef4444" : "#9ca3af" }} />
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 15 }}>{srv.display_name || srv.hostname || srv.machine_id?.slice(0, 12)}</div>
                          <div className="aihub_text_muted" style={{ fontSize: 12 }}>{srvGoverned.length} agent{srvGoverned.length !== 1 ? "s" : ""} governed | {srv.total_calls || 0} traces | {fmtUsd(srv.total_cost_usd)} | avg {srv.avg_latency_ms ? (srv.avg_latency_ms / 1000).toFixed(1) + "s" : "--"}</div>
                        </div>
                      </div>
                      <ChevronRight size={16} style={{ color: "#9ca3af" }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {tab === "traces" && selectedServer && !selectedAgent && (
        <div>
          <button onClick={() => setSelectedServer(null)} style={{ background: "none", border: "none", color: "#2563eb", cursor: "pointer", fontSize: 13, marginBottom: 12, padding: 0, display: "flex", alignItems: "center", gap: 4 }}>
            <ChevronRight size={14} style={{ transform: "rotate(180deg)" }} /> Back to servers
          </button>
          <SectionHeader title={selectedServer.display_name || selectedServer.hostname} hint="Governed agents on this server. Click an agent to see its traces." />
          {(() => {
            const srvGoverned = governed.filter(g => g.machine_id === selectedServer.machine_id);
            if (srvGoverned.length === 0) {
              return <Empty icon={<Shield size={24} />} title="No governed agents" msg="Run 'sudo cloudfuze-monitor govern' on this server to start tracking Docker containers." />;
            }
            return (
              <div style={{ display: "grid", gap: 10 }}>
                {srvGoverned.map(agent => (
                  <div key={agent.container_name} onClick={() => { setSelectedAgent(agent); setDateFrom(""); setDateTo(""); }}
                    style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: 16, cursor: "pointer", transition: "border-color 0.2s" }}
                    onMouseEnter={e => e.currentTarget.style.borderColor = "#3b82f6"}
                    onMouseLeave={e => e.currentTarget.style.borderColor = "#e2e5ea"}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <div style={{ width: 32, height: 32, borderRadius: 8, background: "#eff6ff", display: "flex", alignItems: "center", justifyContent: "center" }}>
                          <Shield size={16} style={{ color: "#3b82f6" }} />
                        </div>
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 14 }}>{agent.container_name}</div>
                          <div className="aihub_text_muted" style={{ fontSize: 12 }}>
                            IP: {agent.container_ip || "?"} | {agent.total_calls || 0} traces | {fmtUsd(agent.total_cost_usd)} | avg {agent.avg_latency_ms ? (agent.avg_latency_ms / 1000).toFixed(1) + "s" : "--"}
                          </div>
                        </div>
                      </div>
                      <ChevronRight size={16} style={{ color: "#9ca3af" }} />
                    </div>
                  </div>
                ))}
              </div>
            );
          })()}
        </div>
      )}

      {tab === "traces" && selectedServer && selectedAgent && !selectedTrace && (
        <div>
          <button onClick={() => setSelectedAgent(null)} style={{ background: "none", border: "none", color: "#2563eb", cursor: "pointer", fontSize: 13, marginBottom: 12, padding: 0, display: "flex", alignItems: "center", gap: 4 }}>
            <ChevronRight size={14} style={{ transform: "rotate(180deg)" }} /> Back to {selectedServer.display_name}
          </button>
          <SectionHeader title={selectedAgent.container_name} hint={`Individual AI API calls from this agent (${agentCalls.length} total)`} />
          <div style={{ display: "flex", gap: 12, marginBottom: 14, alignItems: "center", flexWrap: "wrap" }}>
            <label style={{ fontSize: 12, color: "#6b7280" }}>From:</label>
            <input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); }} style={{ padding: "4px 8px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 12 }} />
            <label style={{ fontSize: 12, color: "#6b7280" }}>To:</label>
            <input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); }} style={{ padding: "4px 8px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 12 }} />
            <button onClick={fetchAgentCalls} style={{ padding: "4px 12px", borderRadius: 6, border: "1px solid #d1d5db", background: "#fff", fontSize: 12, cursor: "pointer" }}>Filter</button>
            {(dateFrom || dateTo) && <button onClick={() => { setDateFrom(""); setDateTo(""); }} style={{ padding: "4px 12px", borderRadius: 6, border: "none", background: "#f3f4f6", fontSize: 12, cursor: "pointer", color: "#6b7280" }}>Clear</button>}
          </div>
          <div style={{ maxHeight: 600, overflowY: "auto" }}>
          <DataTable columns={[
            { label: "Time", render: r => <span style={{ fontSize: 12 }}>{relTime(r.occurred_at)}</span> },
            { label: "Provider", render: r => <Tag text={r.provider || "?"} color={r.provider === "openai" ? "#10a37f" : r.provider === "anthropic" ? "#d97706" : "#6366f1"} /> },
            { label: "Model", render: r => <span style={{ fontSize: 12, fontWeight: 500 }}>{(r.model || "?").replace(/-\d{4}-\d{2}-\d{2}$/, "")}</span> },
            { label: "Tokens", render: r => fmtTokens((r.prompt_tokens || 0) + (r.completion_tokens || 0)), right: true },
            { label: "Cost", render: r => fmtUsd(traceCost(r)), right: true },
            { label: "Duration", render: r => <span>{r.duration_ms ? (r.duration_ms / 1000).toFixed(1) + "s" : "\u2014"}</span>, right: true },
          ]} rows={agentCalls} empty="No traces yet for this agent." onRow={r => setSelectedTrace(r.id)} />
          </div>
        </div>
      )}

      {tab === "traces" && selectedTrace && traceDetail && (
        <div>
          <button onClick={() => setSelectedTrace(null)} style={{ background: "none", border: "none", color: "#2563eb", cursor: "pointer", fontSize: 13, marginBottom: 12, padding: 0, display: "flex", alignItems: "center", gap: 4 }}>
            <ChevronRight size={14} style={{ transform: "rotate(180deg)" }} /> Back to {selectedAgent?.container_name || "traces"}
          </button>
          <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: 24 }}>
            {/* Header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <Tag text={traceDetail.provider || "?"} color={traceDetail.provider === "openai" ? "#10a37f" : traceDetail.provider === "anthropic" ? "#d97706" : "#6366f1"} />
                  <h3 style={{ margin: 0, fontSize: 16 }}>{(traceDetail.model || "?").replace(/-\d{4}-\d{2}-\d{2}$/, "")}</h3>
                </div>
                <div className="aihub_text_muted" style={{ fontSize: 12 }}>
                  {traceDetail.host}{traceDetail.path || ""} | {new Date(traceDetail.occurred_at || traceDetail.started_at).toLocaleString()}
                </div>
              </div>
              <div style={{ display: "flex", gap: 16, textAlign: "right" }}>
                <div><div style={{ fontSize: 18, fontWeight: 700 }}>{fmtTokens((traceDetail.prompt_tokens||0)+(traceDetail.completion_tokens||0))}</div><div className="aihub_text_muted" style={{ fontSize: 11 }}>tokens</div></div>
                <div><div style={{ fontSize: 18, fontWeight: 700 }}>{traceDetail.duration_ms ? (traceDetail.duration_ms/1000).toFixed(1)+"s" : "--"}</div><div className="aihub_text_muted" style={{ fontSize: 11 }}>duration</div></div>
                <div><div style={{ fontSize: 18, fontWeight: 700 }}>{fmtUsd(traceCost(traceDetail))}</div><div className="aihub_text_muted" style={{ fontSize: 11 }}>cost</div></div>
              </div>
            </div>

            {/* Token breakdown */}
            <div style={{ display: "flex", gap: 12, marginBottom: 20 }}>
              <div style={{ flex: 1, background: "#f0fdf4", borderRadius: 8, padding: 12 }}>
                <div style={{ fontSize: 11, color: "#166534", fontWeight: 600, marginBottom: 2 }}>PROMPT TOKENS</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: "#166534" }}>{fmtTokens(traceDetail.prompt_tokens)}</div>
              </div>
              <div style={{ flex: 1, background: "#eff6ff", borderRadius: 8, padding: 12 }}>
                <div style={{ fontSize: 11, color: "#1e40af", fontWeight: 600, marginBottom: 2 }}>COMPLETION TOKENS</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: "#1e40af" }}>{fmtTokens(traceDetail.completion_tokens)}</div>
              </div>
              <div style={{ flex: 1, background: "#fefce8", borderRadius: 8, padding: 12 }}>
                <div style={{ fontSize: 11, color: "#854d0e", fontWeight: 600, marginBottom: 2 }}>RESPONSE STATUS</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: traceDetail.response_status >= 400 ? "#dc2626" : "#166534" }}>{traceDetail.response_status || 200}</div>
              </div>
            </div>

            {(() => {
              // Parse the raw prompt/response to extract user input and assistant output
              let userInput = null;
              let assistantOutput = null;
              let systemPrompt = null;
              let toolCalls = [];

              // Parse prompt_text — could be clean JSON or raw HTTP body
              try {
                const raw = typeof traceDetail.prompt_text === 'string' ? traceDetail.prompt_text : '';
                // Try direct JSON parse first
                let body = null;
                try { body = JSON.parse(raw); } catch {
                  // Truncated JSON — find last user message via regex
                  const userMatch = raw.match(/"role"\s*:\s*"user"\s*,\s*"content"\s*:\s*"([^"]+)"/g);
                  if (userMatch) {
                    const lastMatch = userMatch[userMatch.length - 1];
                    const contentMatch = lastMatch.match(/"content"\s*:\s*"([^"]+)"/);
                    if (contentMatch) userInput = contentMatch[1];
                  }
                  // Don't extract tool calls from request — they're just definitions.
                  // Actual tool calls come from the response (handled below).
                }
                if (body && Array.isArray(body?.messages)) {
                  // Extract last user message
                  const userMsgs = body.messages.filter(m => m.role === 'user');
                  if (userMsgs.length > 0) {
                    const last = userMsgs[userMsgs.length - 1];
                    userInput = typeof last.content === 'string' ? last.content
                      : Array.isArray(last.content) ? last.content.map(c => c.text || '').join('') : '';
                  }
                  // Extract system prompt
                  const sysMsgs = body.messages.filter(m => m.role === 'system');
                  if (sysMsgs.length > 0) {
                    systemPrompt = typeof sysMsgs[0].content === 'string' ? sysMsgs[0].content
                      : Array.isArray(sysMsgs[0].content) ? sysMsgs[0].content.map(c => c.text || '').join('') : '';
                    if (systemPrompt.length > 200) systemPrompt = systemPrompt.slice(0, 200) + '...';
                  }
                  // Extract tool calls
                  body.messages.forEach(m => {
                    if (m.role === 'assistant' && Array.isArray(m.tool_calls)) {
                      m.tool_calls.forEach(tc => {
                        toolCalls.push({ name: tc.function?.name, args: tc.function?.arguments });
                      });
                    }
                  });
                  // Extract tools available
                  if (Array.isArray(body.tools)) {
                    body.tools.forEach(t => {
                      if (t.function?.name && !toolCalls.some(tc => tc.name === t.function.name)) {
                        // Don't add available tools to toolCalls — only called ones
                      }
                    });
                  }
                }
              } catch {
                // Complete parse failure — show nothing rather than raw JSON
                userInput = null;
              }

              // Parse response — could be JSON or pre-formatted text
              try {
                const raw = typeof traceDetail.response_text === 'string' ? traceDetail.response_text : '';
                let parsed = false;

                // Try JSON parse first
                try {
                  const body = JSON.parse(raw);
                  const choice = body?.choices?.[0]?.message;
                  if (choice?.content) {
                    assistantOutput = choice.content;
                    parsed = true;
                  }
                  if (Array.isArray(choice?.tool_calls)) {
                    choice.tool_calls.forEach(tc => {
                      toolCalls.push({ name: tc.function?.name, args: tc.function?.arguments });
                    });
                    if (!assistantOutput) parsed = true;
                  }
                } catch {}

                // If JSON failed, check for [tool:name] format from cost-parser
                if (!parsed && raw) {
                  const toolPattern = /\[tool:(\w+)\]\s*(.*)/g;
                  let match;
                  while ((match = toolPattern.exec(raw)) !== null) {
                    toolCalls.push({ name: match[1], args: match[2] || '' });
                  }
                  // Remove tool call text from output, keep any remaining text
                  const cleanOutput = raw.replace(/\[tool:\w+\]\s*\{[^}]*\}/g, '').trim();
                  if (cleanOutput) assistantOutput = cleanOutput;
                }
              } catch {
                assistantOutput = traceDetail.response_text;
              }

              return (
                <>
                  {/* User Input */}
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "#166534", marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}>
                      <div style={{ width: 8, height: 8, borderRadius: 2, background: "#22c55e" }} /> USER INPUT
                    </div>
                    <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 8, padding: 14 }}>
                      {userInput ? (
                        <div style={{ fontSize: 14, lineHeight: 1.6, color: "#1f2937" }}>{userInput}</div>
                      ) : (
                        <span className="aihub_text_muted" style={{ fontSize: 12 }}>User input not available.</span>
                      )}
                    </div>
                  </div>

                  {/* Tool Calls (if any) */}
                  {toolCalls.length > 0 && (
                    <div style={{ marginBottom: 16 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: "#7c3aed", marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}>
                        <div style={{ width: 8, height: 8, borderRadius: 2, background: "#8b5cf6" }} /> TOOL CALLS ({toolCalls.length})
                      </div>
                      <div style={{ display: "grid", gap: 8 }}>
                        {toolCalls.slice(-5).map((tc, i) => (
                          <div key={i} style={{ background: "#f5f3ff", border: "1px solid #ddd6fe", borderRadius: 8, padding: 12 }}>
                            <div style={{ fontSize: 13, fontWeight: 600, color: "#5b21b6", marginBottom: 4 }}>{tc.name || "unknown"}</div>
                            <pre style={{ margin: 0, fontSize: 11, color: "#6b7280", whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 100, overflowY: "auto" }}>
                              {(() => { try { return JSON.stringify(JSON.parse(tc.args || '{}'), null, 2); } catch { return tc.args || ''; } })()}
                            </pre>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Assistant Output */}
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "#1e40af", marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}>
                      <div style={{ width: 8, height: 8, borderRadius: 2, background: "#3b82f6" }} /> ASSISTANT OUTPUT
                    </div>
                    <div style={{ background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 8, padding: 14 }}>
                      {assistantOutput ? (
                        <div style={{ fontSize: 14, lineHeight: 1.6, color: "#1f2937", whiteSpace: "pre-wrap" }}>{assistantOutput}</div>
                      ) : (
                        <span className="aihub_text_muted" style={{ fontSize: 12 }}>Assistant output not available.</span>
                      )}
                    </div>
                  </div>

                  {/* System Prompt (collapsed) */}
                  {systemPrompt && (
                    <details style={{ marginBottom: 16 }}>
                      <summary style={{ fontSize: 12, fontWeight: 600, color: "#6b7280", cursor: "pointer", marginBottom: 6 }}>
                        System Prompt ({systemPrompt.length} chars)
                      </summary>
                      <div style={{ background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 8, padding: 14, maxHeight: 200, overflowY: "auto" }}>
                        <pre style={{ margin: 0, fontSize: 11, lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word", color: "#6b7280" }}>
                          {systemPrompt}
                        </pre>
                      </div>
                    </details>
                  )}
                </>
              );
            })()}
          </div>
        </div>
      )}

      {tab === "servers" && (
        <div>
          <SectionHeader title="Connected Servers" hint="Servers running the CloudFuze server monitor" />
          <DataTable columns={[
            { label: "Server", render: r => <Mono>{r.display_name || r.machine_id}</Mono> },
            { label: "Status", render: r => <Badge text={r.status} color={r.status === "active" ? "#22c55e" : "#9ca3af"} /> },
            { label: "Last Seen", render: r => relTime(r.last_seen) },
            { label: "Calls", key: "total_calls", right: true },
            { label: "Cost", render: r => fmtUsd(r.total_cost_usd), right: true },
            { label: "Users", render: r => (r.users || []).join(", ") || "\u2014" },
            { label: "Providers", render: r => <div>{(r.providers || []).map(p => <Tag key={p} text={p} />)}</div> },
          ]} rows={servers} empty="No servers connected yet. Go to Setup tab to install." />
        </div>
      )}

      {tab === "setup" && (
        <div>
          <SectionHeader title="Install Server Monitor" hint="Monitor all AI agent activity on any Linux/macOS server. Detects and governs every AI API call automatically." />
          <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: 24 }}>

            {/* Step 1: Configure */}
            <div style={{ display: "flex", gap: 12, marginBottom: 24 }}>
              <div style={{ width: 32, height: 32, minWidth: 32, borderRadius: "50%", background: "#dbeafe", color: "#2563eb", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 14 }}>1</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>Configure your server</div>
                <div className="aihub_text_muted" style={{ fontSize: 12, marginBottom: 14 }}>Enter the proxy port the monitor will listen on. This port intercepts all outbound AI API traffic from every process on the server.</div>

                <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
                  <div>
                    <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 4 }}>Proxy Port</label>
                    <input type="number" value={proxyPort} onChange={e => { setProxyPort(e.target.value); setInstallCmd(""); }}
                      style={{ width: 120, padding: "8px 12px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 14, fontFamily: "ui-monospace, monospace" }}
                      placeholder="8443" min="1024" max="65535" />
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 4 }}>Server IP / Hostname <span style={{ fontWeight: 400, color: "#9ca3af" }}>(optional)</span></label>
                    <input type="text" value={serverIp} onChange={e => { setServerIp(e.target.value); setInstallCmd(""); }}
                      style={{ width: 220, padding: "8px 12px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 14 }}
                      placeholder="auto-detect" />
                  </div>
                  <button onClick={generateInstallCmd} disabled={generating || !proxyPort}
                    style={{ padding: "8px 20px", borderRadius: 6, border: "none", background: "#2563eb", color: "#fff", fontSize: 13, fontWeight: 600, cursor: generating ? "wait" : "pointer", opacity: generating ? 0.6 : 1, height: 38 }}>
                    {generating ? "Generating..." : "Generate Install Command"}
                  </button>
                </div>
              </div>
            </div>

            {/* Step 2: Install command */}
            <div style={{ display: "flex", gap: 12, marginBottom: 24 }}>
              <div style={{ width: 32, height: 32, minWidth: 32, borderRadius: "50%", background: installCmd ? "#dcfce7" : "#f3f4f6", color: installCmd ? "#16a34a" : "#9ca3af", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 14 }}>2</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>Run this command on your server</div>
                <div className="aihub_text_muted" style={{ fontSize: 12, marginBottom: 10 }}>SSH into your server and paste this command. Requires sudo access.</div>
                {installCmd ? (
                  <div style={{ background: "#1e293b", color: "#e2e8f0", borderRadius: 8, padding: 16, fontFamily: "ui-monospace, monospace", fontSize: 12, overflowX: "auto", position: "relative", lineHeight: 1.6, wordBreak: "break-all" }}>
                    <code>{installCmd}</code>
                    <button onClick={copyCmd} title={copied ? "Copied!" : "Copy to clipboard"}
                      style={{ position: "absolute", top: 10, right: 10, background: "none", border: "none", color: copied ? "#4ade80" : "#94a3b8", cursor: "pointer", padding: 2, transition: "color 0.2s", display: "flex", alignItems: "center" }}>
                      {copied ? <Check size={16} /> : <Copy size={16} />}
                    </button>
                  </div>
                ) : (
                  <div style={{ background: "#f9fafb", border: "1px dashed #d1d5db", borderRadius: 8, padding: 16, textAlign: "center", color: "#9ca3af", fontSize: 13 }}>
                    Configure port above and click "Generate Install Command"
                  </div>
                )}
              </div>
            </div>

            {/* Step 3: Done */}
            <div style={{ display: "flex", gap: 12, marginBottom: 20 }}>
              <div style={{ width: 32, height: 32, minWidth: 32, borderRadius: "50%", background: "#f3f4f6", color: "#9ca3af", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 14 }}>3</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>ALL agents are instantly governed</div>
                <div className="aihub_text_muted" style={{ fontSize: 12 }}>The installer sets up an <code style={{ background: "#f1f5f9", padding: "1px 4px", borderRadius: 3 }}>iptables</code> transparent redirect that captures ALL outbound port-443 traffic at the kernel level. Every process &mdash; already running or new &mdash; is governed instantly. No code changes, no env vars, no agent restarts needed. Works with Node.js, Python, Go, curl, anything.</div>
              </div>
            </div>

            {/* What gets captured */}
            <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 8, padding: 14, marginTop: 8 }}>
              <div style={{ fontWeight: 600, fontSize: 13, color: "#166534", marginBottom: 6 }}>What gets captured from every AI agent on the server:</div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: "#166534", lineHeight: 1.8 }}>
                <li>Every LLM API call &mdash; provider, model, tokens, cost, full prompt and response</li>
                <li>Who made the call &mdash; user, process ID, command line, working directory</li>
                <li>How it was triggered &mdash; SSH session, cron job, CI pipeline, systemd service, Docker container</li>
                <li>Timing &mdash; duration, latency, HTTP status, errors</li>
                <li>Local models too &mdash; Ollama, vLLM, llama.cpp on localhost are also governed</li>
              </ul>
            </div>

            {/* How it works */}
            <div style={{ background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 8, padding: 14, marginTop: 12 }}>
              <div style={{ fontWeight: 600, fontSize: 13, color: "#1e40af", marginBottom: 6 }}>How it works:</div>
              <div style={{ fontSize: 12, color: "#1e40af", lineHeight: 1.7 }}>
                The monitor uses <strong>iptables transparent redirect</strong> to capture ALL outbound HTTPS traffic at the kernel level. Every connection to port 443 is redirected through the monitor's proxy, which reads the SNI hostname from the TLS handshake. AI provider traffic (OpenAI, Anthropic, Google, AWS, local models) is intercepted and logged with full prompt/response, cost, and process attribution. Non-AI traffic is bridged transparently with zero overhead. Works on already-running processes &mdash; no restart needed.
              </div>
            </div>

            {/* Docker governance */}
            <div style={{ background: "#f5f3ff", border: "1px solid #c4b5fd", borderRadius: 8, padding: 14, marginTop: 12 }}>
              <div style={{ fontWeight: 600, fontSize: 13, color: "#5b21b6", marginBottom: 6 }}>Docker Container Governance:</div>
              <div style={{ fontSize: 12, color: "#5b21b6", lineHeight: 1.7, marginBottom: 8 }}>
                After installing, host processes are <strong>fully governed</strong> (prompt, response, tokens, cost &mdash; everything captured).
                Docker containers are tracked at the network level (which AI provider, when, duration). To enable <strong>full governance inside a container</strong>
                (prompt/response content, token counts, cost), run:
              </div>
              <div style={{ fontSize: 12, color: "#5b21b6", lineHeight: 1.7 }}>
                <code style={{ background: "#ede9fe", padding: "2px 6px", borderRadius: 3 }}>sudo cloudfuze-monitor govern</code>
                <div style={{ marginTop: 4, fontSize: 11, color: "#7c3aed" }}>Interactive &mdash; lists containers, you pick which ones to govern, one at a time. Each container gets the CA cert injected and restarts automatically.</div>
              </div>
            </div>

            {/* Commands reference */}
            <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, padding: 14, marginTop: 12 }}>
              <div style={{ fontWeight: 600, fontSize: 13, color: "#111", marginBottom: 8 }}>Available Commands:</div>
              <div style={{ fontSize: 12, color: "#374151", fontFamily: "ui-monospace, monospace", lineHeight: 2.0 }}>
                <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: "2px 16px" }}>
                  <span>cloudfuze-monitor status</span><span style={{ color: "#6b7280" }}>Show service status</span>
                  <span>cloudfuze-monitor logs</span><span style={{ color: "#6b7280" }}>Stream live logs</span>
                  <span>cloudfuze-monitor restart</span><span style={{ color: "#6b7280" }}>Restart the monitor</span>
                  <span>cloudfuze-monitor update</span><span style={{ color: "#6b7280" }}>Update to latest version</span>
                  <span>cloudfuze-monitor govern</span><span style={{ color: "#6b7280" }}>Enable full governance per Docker container</span>
                  <span>cloudfuze-monitor uninstall</span><span style={{ color: "#6b7280" }}>Remove completely</span>
                  <span>cloudfuze-monitor help</span><span style={{ color: "#6b7280" }}>Show all commands</span>
                </div>
              </div>
              <div className="aihub_text_muted" style={{ fontSize: 11, marginTop: 8 }}>
                Run these commands on the server where the monitor is installed. Most require <code>sudo</code>.
              </div>
            </div>

            {/* Coverage & Limitations */}
            <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, padding: 14, marginTop: 12 }}>
              <div style={{ fontWeight: 600, fontSize: 13, color: "#111", marginBottom: 8 }}>Coverage:</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "4px 16px", fontSize: 12, lineHeight: 1.8 }}>
                <span>Host processes (direct on server)</span><span style={{ color: "#16a34a", fontWeight: 600 }}>Full governance</span>
                <span>Docker containers (bridge network)</span><span style={{ color: "#16a34a", fontWeight: 600 }}>Full governance *</span>
                <span>Docker containers (custom bridge)</span><span style={{ color: "#16a34a", fontWeight: 600 }}>Full governance *</span>
                <span>Docker containers (host network)</span><span style={{ color: "#16a34a", fontWeight: 600 }}>Full governance</span>
              </div>
              <div style={{ fontSize: 11, color: "#6b7280", marginTop: 6 }}>* Requires <code>docker-enable</code> + container restart for prompt/response content.</div>
              <div style={{ fontWeight: 600, fontSize: 13, color: "#111", marginTop: 12, marginBottom: 8 }}>Not supported:</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "4px 16px", fontSize: 12, lineHeight: 1.8, color: "#6b7280" }}>
                <span>Docker Macvlan/IPvlan networks</span><span>Rare — traffic bypasses bridge</span>
                <span>Kubernetes pods</span><span>Requires sidecar approach</span>
                <span>Podman rootless containers</span><span>Runs in user namespace</span>
                <span>VPN/tunnel-wrapped traffic</span><span>Encrypted before iptables</span>
              </div>
            </div>

            {/* Uninstall */}
            <div style={{ background: "#fefce8", border: "1px solid #fde68a", borderRadius: 8, padding: 14, marginTop: 12 }}>
              <div style={{ fontWeight: 600, fontSize: 13, color: "#854d0e", marginBottom: 6 }}>To uninstall:</div>
              <code style={{ fontSize: 12, color: "#854d0e" }}>sudo cloudfuze-monitor uninstall</code>
              <div className="aihub_text_muted" style={{ fontSize: 11, marginTop: 4 }}>Stops the service, removes iptables rules, CA, proxy config, and all files.</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// NAVIGATION — six top-level screens, each grouping related views behind tabs.
//
// The sidebar used to carry sixteen entries, which is a list you read rather than
// navigate. They were organised per data table (one screen per endpoint) instead
// of per question, so answering "who is risky" meant joining three screens by eye.
// Each group below answers ONE question: what exists / what happened / what are we
// enforcing / what do the cloud agents look like / how do I wire it up.
//
// Agent Governance stays exactly as it is. Its own tab bar is already this same
// consolidation, and 10 of its 12 tabs read a shared context that fetches the
// discovery data once — redistributing them across these groups would mount that
// provider several times over, each refetching and holding divergent state.
// Deleting the duplicate "AI Budget" entry is enough: BudgetTab already lives
// inside Agent Governance, which is also where its Cost tab is.
// ═══════════════════════════════════════════════════════════════════════════════

// Tabs are keyed by a URL slug, not by index, so ?tab= stays valid when tabs are
// reordered or inserted. Deep links get pasted into tickets and audit notes; a
// positional index would silently point somewhere else after any edit here.
// ── Installations View ────────────────────────────────────────────────────

function InstallationsView() {
  const [info,setInfo]=useState(null);
  const [err,setErr]=useState(null);
  const [copied,setCopied]=useState(null);
  const [downloading,setDownloading]=useState(null); // 'extension' | 'windows' | 'macos' | 'linux'

  useEffect(()=>{
    fetch("/api/v1/installations/info").then(r=>r.json()).then(setInfo).catch(x=>setErr(x.message));
  },[]);

  const copy=(text,id)=>{
    const ta=document.createElement("textarea");ta.value=text;ta.style.cssText="position:fixed;left:-9999px";
    document.body.appendChild(ta);ta.select();document.execCommand("copy");document.body.removeChild(ta);
    setCopied(id);setTimeout(()=>setCopied(null),2000);
  };

  const download=async(url,filename,id)=>{
    setDownloading(id);
    try {
      const r=await fetch(url);
      if(!r.ok) {
        const body=await r.json().catch(()=>({}));
        throw new Error(body.error ? `${body.error}${body.detail?': '+body.detail:''}` : `HTTP ${r.status}`);
      }
      const blob=await r.blob();
      const a=document.createElement('a');
      a.href=URL.createObjectURL(blob);
      a.download=filename;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch(e) { alert('Download failed: '+e.message); }
    setDownloading(null);
  };

  if(err) return <Err msg={err}/>;
  if(!info) return <Loading/>;

  return (<div>
    <SectionHeader title="Installations" hint="Download and deploy the browser extension and desktop agent to your employees' machines"/>

    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:20}}>

      {/* Desktop Agent */}
      <div className="aihub_card">
        <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:14}}>
          <div style={{width:44,height:44,borderRadius:10,background:"#eff6ff",display:"flex",alignItems:"center",justifyContent:"center",fontSize:22}}>💻</div>
          <div>
            <h4 style={{margin:0,fontSize:15,fontWeight:700}}>Desktop Agent</h4>
            <div style={{fontSize:11,color:"#9ca3af"}}>Windows · macOS · Linux</div>
          </div>
          <div style={{marginLeft:"auto",fontSize:10,color:"#0052e0",background:"#eff6ff",padding:"3px 8px",borderRadius:6,fontWeight:600}}>Step 1</div>
        </div>

        <div style={{fontSize:12,color:"#6b7280",marginBottom:14,lineHeight:1.5}}>
          Scans the machine for AI tools, monitors clipboard & prompts, and runs the identity beacon so the browser extension knows who this employee is.
        </div>

        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:14}}>
          <button disabled={!!downloading} onClick={()=>download('/api/v1/installations/agent-installer?platform=windows','CloudFuze-Desktop-Agent-windows.zip','windows')} style={{display:"flex",alignItems:"center",justifyContent:"center",gap:4,padding:"9px 0",borderRadius:8,background:downloading==='windows'?"#6b7280":"#0052e0",color:"#fff",fontSize:12,fontWeight:600,border:"none",cursor:downloading?"wait":"pointer",opacity:downloading&&downloading!=='windows'?0.5:1}}>{downloading==='windows'?'⏳ Preparing...':'⬇ Windows'}</button>
          <button disabled={!!downloading} onClick={()=>download('/api/v1/installations/agent-installer?platform=macos','CloudFuze-Desktop-Agent-macos.zip','macos')} style={{display:"flex",alignItems:"center",justifyContent:"center",gap:4,padding:"9px 0",borderRadius:8,background:downloading==='macos'?"#6b7280":"#1e293b",color:"#fff",fontSize:12,fontWeight:600,border:"none",cursor:downloading?"wait":"pointer",opacity:downloading&&downloading!=='macos'?0.5:1}}>{downloading==='macos'?'⏳ Preparing...':'⬇ macOS'}</button>
          <button disabled={!!downloading} onClick={()=>download('/api/v1/installations/agent-installer?platform=linux','CloudFuze-Desktop-Agent-linux.zip','linux')} style={{display:"flex",alignItems:"center",justifyContent:"center",gap:4,padding:"9px 0",borderRadius:8,background:downloading==='linux'?"#6b7280":"#1e293b",color:"#fff",fontSize:12,fontWeight:600,border:"none",cursor:downloading?"wait":"pointer",opacity:downloading&&downloading!=='linux'?0.5:1}}>{downloading==='linux'?'⏳ Preparing...':'⬇ Linux'}</button>
        </div>

        <details style={{fontSize:12,color:"#374151",marginBottom:10}}>
          <summary style={{cursor:"pointer",fontWeight:600,fontSize:13,marginBottom:6}}>Installation steps</summary>
          <ol style={{lineHeight:2,paddingLeft:18,margin:0}}>
            <li>Download the installer for your OS</li>
            <li><strong>Windows:</strong> Extract zip → double-click <code style={{background:"#f1f5f9",padding:"1px 5px",borderRadius:3,fontSize:11}}>install.bat</code></li>
            <li><strong>macOS/Linux:</strong> Extract zip → run <code style={{background:"#f1f5f9",padding:"1px 5px",borderRadius:3,fontSize:11}}>bash install.sh</code></li>
            <li>Agent auto-enrolls, installs dependencies, and starts scanning</li>
          </ol>
        </details>

        <details style={{fontSize:12,color:"#6b7280"}}>
          <summary style={{cursor:"pointer",fontWeight:600,fontSize:12,color:"#374151"}}>IT mass deployment</summary>
          <div style={{marginTop:6,lineHeight:1.6}}>
            Silent: <code style={{background:"#f1f5f9",padding:"1px 5px",borderRadius:3,fontSize:11}}>CloudFuze-Agent.exe /S</code><br/>
            Intune (Win) · Jamf (Mac) · Ansible (Linux)
          </div>
        </details>
      </div>

      {/* Claude Usage Tracker — a separate deliverable from the Desktop Agent above.
          Kept as its own card, not a variant of it: the agent monitors every AI tool
          on the machine, this watches Claude only (claude_tracker/config.js pins
          DESKTOP_PROCESSES to ['Claude']). Deploying it asks colleagues for much
          narrower consent, so the two must not share a button. */}
      <div className="aihub_card">
        <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:14}}>
          <div style={{fontSize:26}}>🧠</div>
          <div>
            <h4 style={{margin:0,fontSize:15,fontWeight:700}}>Claude Usage Tracker</h4>
            <div style={{fontSize:11,color:"#6b7280"}}>Desktop: Windows · Extension: Chrome · Edge · Brave</div>
          </div>
          <div style={{marginLeft:"auto",fontSize:10,fontWeight:700,color:"#8b5cf6",background:"#8b5cf614",border:"1px solid #8b5cf630",borderRadius:999,padding:"3px 9px"}}>Claude only</div>
        </div>

        <div style={{fontSize:12,color:"#4b5563",marginBottom:14,lineHeight:1.5}}>
          Tracks Claude usage per person — Claude Desktop, Claude in the browser and Claude Code CLI.
          It does not scan for other AI tools and does not monitor other sites. Also switches on Claude Code
          telemetry so token counts come from the CLI instead of being estimated.
        </div>

        {/* Two downloads, deliberately separate. The .exe covers Claude Desktop and
            Claude Code CLI; the extension covers Claude in the browser. An admin may
            want either or both, and neither can see anything but Claude. */}
        <div style={{display:"grid",gridTemplateColumns:"repeat(2,minmax(0,1fr))",gap:8}}>
          <button disabled={!!downloading}
                  onClick={()=>download('/api/v1/installations/claude-tracker','CloudFuze-Claude-Usage-Tracker.zip','claude')}
                  style={{display:"flex",alignItems:"center",justifyContent:"center",gap:4,padding:"9px 0",borderRadius:8,background:downloading==='claude'?"#6b7280":"#8b5cf6",color:"#fff",fontSize:12,fontWeight:600,border:"none",cursor:downloading?"wait":"pointer",opacity:downloading&&downloading!=='claude'?0.5:1}}>
            {downloading==='claude'?'⏳ Preparing...':'⬇ Desktop (.exe)'}
          </button>
          <button disabled={!!downloading}
                  onClick={()=>download('/api/v1/installations/extension-package?flavour=claude','CloudFuze-Claude-Extension.zip','claude-ext')}
                  style={{display:"flex",alignItems:"center",justifyContent:"center",gap:4,padding:"9px 0",borderRadius:8,background:downloading==='claude-ext'?"#6b7280":"#7c3aed",color:"#fff",fontSize:12,fontWeight:600,border:"none",cursor:downloading?"wait":"pointer",opacity:downloading&&downloading!=='claude-ext'?0.5:1}}>
            {downloading==='claude-ext'?'⏳ Preparing...':'⬇ Extension'}
          </button>
        </div>

        <details style={{marginTop:12}}>
          <summary style={{fontSize:11,color:"#6b7280",cursor:"pointer"}}>Installation steps</summary>
          <div style={{fontSize:11,fontWeight:700,color:"#374151",marginTop:8}}>Desktop (.exe) — Claude Desktop + Claude Code CLI</div>
          <ol style={{fontSize:11,color:"#4b5563",margin:"4px 0 0",paddingLeft:18,lineHeight:1.7}}>
            <li>Unzip anywhere — keep the <code>.exe</code> and <code>prompt-watcher.ps1</code> together</li>
            <li>Double-click <strong>CloudFuzeClaudeTracker.exe</strong></li>
            <li>It enrols itself and starts reporting — leave it running</li>
            <li>Restart any open Claude Code session so CLI telemetry takes effect</li>
          </ol>
          <div style={{fontSize:11,fontWeight:700,color:"#374151",marginTop:10}}>Extension — Claude in the browser</div>
          <ol style={{fontSize:11,color:"#4b5563",margin:"4px 0 0",paddingLeft:18,lineHeight:1.7}}>
            <li>Unzip the folder and keep it somewhere permanent</li>
            <li><code>chrome://extensions</code> → enable <strong>Developer mode</strong></li>
            <li><strong>Load unpacked</strong> → select the unzipped folder</li>
            <li>It enrols on first load — no configuration needed</li>
          </ol>
          <div style={{fontSize:10.5,color:"#92400e",background:"#fffbeb",border:"1px solid #fde68a",borderRadius:6,padding:"6px 9px",marginTop:8}}>
            The two files must stay in the same folder — the tracker looks for
            prompt-watcher.ps1 beside the executable and exits if it is missing.
          </div>
        </details>
      </div>

      {/* Browser Extension */}
      <div className="aihub_card">
        <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:14}}>
          <div style={{width:44,height:44,borderRadius:10,background:"#f0fdf4",display:"flex",alignItems:"center",justifyContent:"center",fontSize:22}}>🌐</div>
          <div>
            <h4 style={{margin:0,fontSize:15,fontWeight:700}}>Browser Extension</h4>
            <div style={{fontSize:11,color:"#9ca3af"}}>Chrome · Edge · Brave</div>
          </div>
          <div style={{marginLeft:"auto",fontSize:10,color:"#166534",background:"#f0fdf4",padding:"3px 8px",borderRadius:6,fontWeight:600}}>Step 2</div>
        </div>

        <div style={{fontSize:12,color:"#6b7280",marginBottom:14,lineHeight:1.5}}>
          Monitors AI tool usage in the browser — DLP scanning, model routing, access requests. Auto-detects the desktop agent for employee linking.
        </div>

        <button disabled={!!downloading} onClick={()=>download('/api/v1/installations/extension-package','CloudFuze-Browser-Extension.zip','extension')} style={{display:"flex",alignItems:"center",justifyContent:"center",gap:6,padding:"10px 0",borderRadius:8,background:downloading==='extension'?"#6b7280":"#0052e0",color:"#fff",fontSize:13,fontWeight:600,border:"none",cursor:downloading?"wait":"pointer",width:"100%",marginBottom:14,opacity:downloading&&downloading!=='extension'?0.5:1}}>{downloading==='extension'?'⏳ Preparing package...':'⬇ Download Extension'}</button>

        <details style={{fontSize:12,color:"#374151",marginBottom:10}}>
          <summary style={{cursor:"pointer",fontWeight:600,fontSize:13,marginBottom:6}}>Installation steps</summary>
          <ol style={{lineHeight:2,paddingLeft:18,margin:0}}>
            <li>Download and extract the ZIP</li>
            <li>Chrome → <code style={{background:"#f1f5f9",padding:"1px 5px",borderRadius:3,fontSize:11}}>chrome://extensions</code></li>
            <li>Enable <strong>Developer mode</strong></li>
            <li><strong>Load unpacked</strong> → select folder</li>
            <li>Auto-enrolls — no setup needed</li>
          </ol>
        </details>

        <details style={{fontSize:12,color:"#6b7280"}}>
          <summary style={{cursor:"pointer",fontWeight:600,fontSize:12,color:"#374151"}}>IT mass deployment</summary>
          <div style={{marginTop:6,lineHeight:1.6}}>
            Chrome Enterprise policy:<br/>
            <code style={{background:"#f1f5f9",padding:"2px 6px",borderRadius:3,fontSize:10}}>ExtensionInstallForcelist</code>
          </div>
        </details>
      </div>
    </div>

    <div style={{textAlign:"center",marginTop:14,fontSize:11,color:"#9ca3af"}}>
      Both components are pre-configured with your server URL — zero employee setup required.
    </div>
  </div>);
}

const TAB_GROUPS = {
  Inventory: {
    title: "Inventory",
    // No group hint: both tabs under it already carry their own description
    // ("AI & Agent Registry" and "Agents & MCP"), so this restated the same thing
    // one line above whichever tab was open.
    tabs: [
      { slug: "systems", label: "AI Systems",   component: AIRegistryView },
      { slug: "agents",  label: "Agents & MCP", component: AgentsView },
      // Platforms folded into AI Systems: the known-services catalog is merged in
      // there and deduped, so one table now answers "what AI exists here?" instead
      // of two that had to be read together. Adding a platform, the block/allow
      // decision and the risk analysis for a service now all sit in one place —
      // previously they were spread across two tabs.
      // PlatformsView is still defined (its session-replay panel has no equivalent
      // in the merged table) but is no longer mounted anywhere.
      // { slug: "platforms", label: "Platform detail", component: PlatformsView },
    ],
  },
  Activity: {
    title: "Activity",
    // No group hint: each tab under it already carries its own description, and this
    // one had also gone stale — it still advertised "full session replays" after the
    // Sessions tab was hidden.
    tabs: [
      { slug: "prompts",  label: "Prompts & DLP", component: DLPView },
      // Sessions hidden from the tab strip again after review: the capture holds
      // conversation groupings but zero rrweb recordings, so the replay half of the
      // view has nothing to play. SessionReplayView and every endpoint behind it are
      // untouched, so uncommenting this line brings it back. /AIHub/SessionReplay
      // still redirects here and resolveTab falls back to the first tab, so the old
      // URL lands on Prompts & DLP rather than breaking.
      // { slug: "sessions", label: "Sessions",      component: SessionReplayView },
      { slug: "claude",   label: "Claude Usage",  component: ClaudeUsageView },
      // Model Routing hidden from the tab strip, to be restored — same treatment as
      // Sessions above. ModelRoutingView and its /api/v1/routing/* endpoints are
      // untouched; /AIHub/ModelRouting still redirects here and lands on the first
      // tab. Uncommenting this line is the whole of putting it back.
      // { slug: "routing",  label: "Model Routing", component: ModelRoutingView },
    ],
  },
  PoliciesRisk: {
    // Named "Policies & Risk" rather than "Governance": sitting next to the
    // existing "Agent Governance" entry, two things called governance would be a
    // coin toss for the user. Renaming their established screen is the riskier fix.
    title: "Policies & Risk",
    hint: "The policies you are enforcing, the framework packs you can draw from, and who is risky.",
    tabs: [
      // Governance policies lead: these are the rules actually running against the
      // agent fleet, so they are what someone opening this screen came to see.
      // Policy Packs sits behind them as the library you deploy FROM — deploying a
      // pack materialises its rules into this same list.
      //
      // Wrapped in AgentGovernanceProvider because PoliciesTab reads the shared
      // discovery context. The provider is also mounted by the Agent Governance
      // screen, but the two are never on screen together, so there is no duplicate
      // in-flight state — just one fetch per screen visit.
      { slug: "policies", label: "Policies", component: function PoliciesPage() {
        return <AgentGovernanceProvider><PoliciesTab/></AgentGovernanceProvider>;
      } },
      // Policy Packs merged into the Policies tab — the "Policy Packs" button
      // inside PoliciesTab opens an inline drawer with deploy/undeploy.
      // PolicyPacksView is still defined and reachable by direct URL.
      { slug: "risk",  label: "Risk Scores",  component: RiskScoreView },
      // EU AI Act belongs here as a 3rd tab once its intake is seeded from the
      // discovered agent registry. EuAiActView above is intact and unmounted.
      // { slug: "eu-ai-act", label: "EU AI Act", component: EuAiActView },
    ],
  },
  SDK: {
    title: "SDK",
    hint: "Credentials for apps that report their AI activity here, and what they've reported.",
    tabs: [
      { slug: "projects", label: "Projects", component: SdkProjectsView },
      { slug: "traces",   label: "Traces",   component: SdkTracesView },
    ],
  },
  Setup: {
    title: "Setup",
    hint: "Wiring and one-off assessments. Configure once, then rarely visit.",
    tabs: [
      { slug: "installations", label: "Installations",     component: InstallationsView },
      { slug: "integrations", label: "Integrations",      component: IntegrationsView },
      // The old hidden "Developer SDK" tab is gone: its DeveloperSDKView could not
      // work (api_key fields the server never returns, no Authorization header at
      // admin-gated routes, snippets posting to a removed endpoint via a
      // globalThis.fetch monkey-patch). It is replaced by the SDK group above, not
      // duplicated — /AIHub/DeveloperSDK now redirects there.
      { slug: "server-monitor", label: "Server Monitor",  component: ServerMonitorView },
      // { slug: "copilot",      label: "Copilot Readiness", component: CopilotReadinessView },  // hidden — not working reliably
      // Machines is commented out because Policies & Risk → Risk Scores already
      // lists every enrolled machine: all of its rows carry a hostname, sourced
      // from the agent and the extension. /AIHub/Machines redirects there.
      // MachinesView below is intact and unmounted.
      // { slug: "machines", label: "Machines", component: MachinesView },
    ],
  },
};

// Single-view screens. The trailing entries are not in the sidebar — they were
// already hidden before this regrouping and stay reachable by URL only, so no
// bookmark breaks and nothing new appears in the nav.
const PAGES = {
  Overview:        { title: "AI Overview",      component: OverviewView },
  // Top-level rather than a Policies & Risk tab: this is an inbox, not reference
  // material. Pending requests are somebody waiting on a decision, and a queue
  // buried one click behind a tab is a queue that gets answered late.
  AccessRequests:  { title: "Access Requests",  component: AccessRequestsView },
  AgentGovernance: { title: "Agent Governance", component: AgentGovernance },

  AIUsage:      { title: "AI Usage",      component: AIUsageView },
  Tools:        { title: "Tools Catalog", component: ToolsView },
  ServerAgents: { title: "Server Agents", component: ServerAgentsView },
};

/** Resolve ?tab= against a group, falling back to its first tab. */
function resolveTab(group, slug) {
  return group.tabs.find((t) => t.slug === slug) || group.tabs[0];
}

/**
 * Tabbed group shell.
 *
 * Renders ONLY the active tab rather than mounting every tab hidden. Each view
 * fetches on mount, so mounting all four would fire every request on arrival —
 * the separate screens never did that, and this keeps the network cost of opening
 * a group identical to opening the old single screen.
 */
function TabGroup({ group }) {
  const [params, setParams] = useSearchParams();
  const active = resolveTab(group, params.get("tab"));
  const Body = active.component;

  const select = (t) => {
    if (t.slug === active.slug) return;
    // replace:true — flipping tabs should not stack history entries, or Back has
    // to be pressed once per tab the user glanced at before leaving the screen.
    setParams({ tab: t.slug }, { replace: true });
  };

  return (<div>
    <div className="aihub_group_tabs">
      {group.tabs.map((t) => (
        <button key={t.slug}
                className={`aihub_group_tab ${t.slug === active.slug ? "active" : ""}`}
                style={t.hidden ? {color: t.slug === active.slug ? undefined : "transparent"} : undefined}
                onClick={() => select(t)}>
          {t.label}
        </button>
      ))}
    </div>
    {group.hint && <p className="aihub_group_hint">{group.hint}</p>}
    <Body/>
  </div>);
}

// Which build is actually live. Vite inlines import.meta.env.VITE_* as a string
// literal at build time, and .github/workflows/deploy.yml's `frontend` job
// passes the commit SHA, so a deploy can be confirmed from the page itself
// rather than by guessing whether the push landed. Empty in a local dev
// server, where nothing injects it — hence the "dev" fallback rather than an
// empty stamp.
const BUILD_SHA = String(import.meta.env.VITE_BUILD_SHA || "").slice(0, 7);

export default function AIHubPage({ page }) {
  const [params] = useSearchParams();
  const group = TAB_GROUPS[page];
  const config = PAGES[page];

  // Tab name in the header too, so the breadcrumb still says where you are.
  const heading = group
    ? `${group.title} — ${resolveTab(group, params.get("tab")).label}`
    : (config || PAGES.Overview).title;
  const Single = group ? null : (config || PAGES.Overview).component;

  return (
    <div className="cf_main_container">
      <SideNav activeTab="AI Hub"/>
      <div className="cf_main_content_place">
        <TopNav pageName={heading}/>
        <div className="cf_main_content_place_main" style={{flexDirection:"column",padding:"20px 24px",overflowY:"auto",background:"#f8f9fb"}}>
          {group ? <TabGroup group={group}/> : <Single/>}
          <p className="aihub_build_stamp">build {BUILD_SHA || "dev"}</p>
        </div>
      </div>
    </div>
  );
}
