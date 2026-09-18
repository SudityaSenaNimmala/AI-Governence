// Reads Claude Code usage from the local session transcripts.
//
// Why not rely on OTel: Claude Code's OTLP exporter has no durable queue. If the
// governance server is briefly unreachable — a restart, a laptop suspend, a VPN
// blip — batches are dropped, and in practice the exporter can stop sending for
// the rest of the session. Measured on one machine: OTel had delivered 100 prompt
// events while the transcripts held 331 for a single session. Silent, unbounded
// loss is worse than no feature, because the number still looks plausible.
//
// The transcripts are the durable source: Claude Code writes every turn to
// ~/.claude/projects/<project>/<session>.jsonl as it happens, including exact
// token counts. Reading them locally is lossless across downtime and needs no
// telemetry configuration at all.
//
// Only counts and token totals are read. Prompt and response TEXT is ignored.

import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const PROJECTS_DIR = join(homedir(), '.claude', 'projects');
const STATE_DIR = join(homedir(), '.cloudfuze-claude-tracker');
const WATERMARK_PATH = join(STATE_DIR, 'transcript-watermarks.json');

// Per-file byte offset already reported, so a restart doesn't double-count.
async function loadWatermarks() {
  try { return JSON.parse(await readFile(WATERMARK_PATH, 'utf8')); } catch { return {}; }
}

async function saveWatermarks(w) {
  await mkdir(STATE_DIR, { recursive: true });
  await writeFile(WATERMARK_PATH, JSON.stringify(w, null, 2) + '\n', 'utf8');
}

async function listTranscripts() {
  const out = [];
  let projects;
  try { projects = await readdir(PROJECTS_DIR, { withFileTypes: true }); } catch { return out; }
  for (const p of projects) {
    if (!p.isDirectory()) continue;
    const dir = join(PROJECTS_DIR, p.name);
    let files;
    try { files = await readdir(dir); } catch { continue; }
    for (const f of files) if (f.endsWith('.jsonl')) out.push(join(dir, f));
  }
  return out;
}

// Claude Code names each transcript <session-id>.jsonl, so the filename is the
// session id. Used as the fallback for lines that omit the field (older CLI
// builds, and the occasional summary/mode record).
function sessionIdFromPath(path) {
  const base = path.split(/[\\/]/).pop() || '';
  return base.endsWith('.jsonl') ? base.slice(0, -'.jsonl'.length) : null;
}

function sumUsage(u) {
  const input = Number(u.input_tokens) || 0;
  const output = Number(u.output_tokens) || 0;
  const cacheRead = Number(u.cache_read_input_tokens) || 0;
  const cacheCreate = Number(u.cache_creation_input_tokens) || 0;
  return {
    input_tokens: input,
    output_tokens: output,
    cache_read_tokens: cacheRead,
    cache_creation_tokens: cacheCreate,
    total_tokens: input + output + cacheRead + cacheCreate,
  };
}

// Scan for anything appended since the last run.
// Returns { prompts: [...], usage: [...], watermarks }.
export async function readNewActivity({ log } = {}) {
  const watermarks = await loadWatermarks();
  const prompts = [];
  const usage = [];

  for (const path of await listTranscripts()) {
    let raw;
    try { raw = await readFile(path, 'utf8'); } catch { continue; }

    const seen = watermarks[path] || 0;
    // A shrunken file means it was rotated or replaced — start over rather than
    // silently skipping the whole thing.
    const startAt = raw.length < seen ? 0 : seen;
    if (raw.length === startAt) continue;

    const fresh = raw.slice(startAt);
    for (const line of fresh.split('\n')) {
      if (!line.trim()) continue;
      let o;
      try { o = JSON.parse(line); } catch { continue; }   // partial trailing line

      const ts = o.timestamp || null;

      // A user turn is one prompt. Skip tool results and meta entries, which are
      // also role:"user" but are not something a human typed.
      if (o.type === 'user' && o.message?.role === 'user' && !o.isMeta) {
        const c = o.message.content;
        const isToolResult = Array.isArray(c)
          && c.some((b) => b?.type === 'tool_result');
        if (!isToolResult) {
          const text = typeof c === 'string'
            ? c
            : (Array.isArray(c) ? c.filter((b) => b?.type === 'text').map((b) => b.text || '').join('') : '');
          prompts.push({
            uuid: o.uuid || `${path}:${startAt}:${prompts.length}`,
            occurredAt: ts,
            length: text.length,
            // Which Claude Code session this turn belongs to. The server joins
            // on it to learn whether the session ran in the VS Code / Cursor
            // extension or a plain terminal — the transcripts themselves never
            // say (their `entrypoint` reads "cli" either way), and only OTel
            // reports it. Taken from the line when present and otherwise from
            // the filename, which IS the session id.
            sessionId: o.sessionId || sessionIdFromPath(path),
          });
        }
      }

      // Assistant turns carry exact token counts.
      const u = o.message?.usage;
      if (u) {
        usage.push({
          uuid: o.uuid || o.requestId || null,
          occurredAt: ts,
          model: o.message?.model || null,
          ...sumUsage(u),
        });
      }
    }

    watermarks[path] = raw.length;
  }

  await saveWatermarks(watermarks);
  if (log && (prompts.length || usage.length)) {
    log.info(`transcripts: ${prompts.length} new prompt(s), ${usage.length} usage record(s)`);
  }
  return { prompts, usage };
}
