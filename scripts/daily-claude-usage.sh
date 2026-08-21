#!/usr/bin/env bash
# Daily per-user Claude usage report.
#
# Pulls the governance server's aggregated Claude usage (all surfaces: Claude
# Desktop, Claude in the browser, and Claude Code CLI/IDE), one row per real
# person, and writes a dated CSV. Run it on a schedule (cron / Task Scheduler /
# GitHub Action) to get an accurate daily Claude total per user.
#
#   DAYS=1  -> last 24h (daily usage)    DAYS=30 -> rolling 30-day totals
#
# Usage:  ./daily-claude-usage.sh [output_dir]
set -euo pipefail

BASE="${CFAI_SERVER_URL:-https://agentgovernence.cftools.live}"
DAYS="${DAYS:-1}"
OUT_DIR="${1:-.}"
STAMP="$(date +%Y-%m-%d)"
OUT="${OUT_DIR%/}/claude-usage-${STAMP}.csv"

curl -fsS -m 60 "${BASE}/api/v1/claude-usage?sources=all&days=${DAYS}" \
| node -e '
let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{
  const j=JSON.parse(d);
  const rows=(j.systems||[]).filter(r=>r.attributed).sort((a,b)=>b.prompts-a.prompts);
  const out=["user,hostname,desktop,browser,code_cli,total_prompts,tokens,cost_usd,last_seen"];
  for(const r of rows){
    const bs=r.by_surface||{};
    const desk=bs["Claude Desktop"]||0, br=bs["Claude (browser)"]||0;
    const code=(bs["Claude Code (CLI/extension)"]??bs["Claude Code (CLI)"]??0);
    const tokens=(r.measured_tokens||0)+(r.estimated_tokens||0);
    const cost=((r.measured_cost_usd||0)+(r.estimated_cost_usd||0)).toFixed(4);
    const cell=(v)=>{const s=String(v??"");return /[",]/.test(s)?`"${s.replace(/"/g,`""`)}"`:s;};
    out.push([r.user||r.label,r.hostname||"",desk,br,code,r.prompts||0,tokens,cost,r.last_seen||""].map(cell).join(","));
  }
  process.stdout.write(out.join("\n")+"\n");
});' > "$OUT"

echo "Wrote $OUT ($(($(wc -l < "$OUT")-1)) users, last ${DAYS}d)"
