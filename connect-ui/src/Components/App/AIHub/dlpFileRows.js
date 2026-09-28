// Pure helpers behind the AI Activity (DLP) "File Uploads" table — no React, so
// the scope rule and the block pairing can be checked from plain Node.
//
// Every value read here is untrusted client-supplied text (filenames, agent
// names, pattern names, reasons). These helpers only ever return plain strings
// and numbers; the page renders them as React text nodes, never as HTML.

const HI_CRIT = new Set(["critical", "high"]);

// ±10 minutes: a held attachment can be retried several times while the person
// works out why Send does nothing, and the enforcer has no id to stamp on those
// retries when the file row carries no attachment_id.
export const FILE_BLOCK_WINDOW_MS = 10 * 60 * 1000;

function metaOf(ev) {
  if (ev?.metadata && typeof ev.metadata === "object") return ev.metadata;
  if (typeof ev?.metadata_json === "string") {
    try { const m = JSON.parse(ev.metadata_json); return m && typeof m === "object" ? m : null; }
    catch (err) { void err; return null; }
  }
  return null;
}
const str = v => (typeof v === "string" && v.trim() ? v.trim() : null);

/** True when the desktop agent held (blocked) this attachment. */
export function fileIsHeld(f) { return metaOf(f)?.enforcement === "held"; }

/**
 * Which file rows the table shows: high/critical severity, PLUS every held
 * file — a fail-closed hold (cloud reference, unreadable file) can carry low or
 * no severity, and a blocked file must never be invisible on this screen.
 */
export function fileRowInScope(f) {
  return HI_CRIT.has(String(f?.severity || f?.highest_severity || "").toLowerCase()) || fileIsHeld(f);
}

/** An enforcement_block whose subject was a file attachment, not a prompt. */
export function isFileUploadBlock(ev) {
  if (ev?.event_kind !== "enforcement_block") return false;
  const bf = ev.blocked_for ?? metaOf(ev)?.blocked_for;
  return bf === "file_upload";
}

/**
 * Pair file-upload blocks to the file rows they stopped. Returns
 * Map<fileId, block[]> — each block is counted against at most one file.
 *
 *   EXACT  — block metadata.correlation_id === file metadata.attachment_id.
 *   FALLBACK (only when one side has no id) — same machine_id + same filename +
 *            same ai_service, within ±FILE_BLOCK_WINDOW_MS, nearest file wins.
 *            Two rows that BOTH carry ids and disagree never pair.
 */
export function pairFileBlocks(files, events) {
  const out = new Map();
  const fileList = (files || []).filter(f => f && f.id != null);
  const blocks = [];
  const seen = new Set();
  for (const e of events || []) {
    if (!isFileUploadBlock(e) || seen.has(e.id)) continue;
    seen.add(e.id); blocks.push(e);
  }
  if (!fileList.length || !blocks.length) return out;

  const aidOf = f => str(metaOf(f)?.attachment_id);
  const cidOf = b => str(metaOf(b)?.correlation_id);
  const nameOf = e => str(metaOf(e)?.filename);
  const t = e => new Date(e.occurred_at).getTime();
  const give = (f, b) => { if (!out.has(f.id)) out.set(f.id, []); out.get(f.id).push(b); };

  const byAid = new Map();
  for (const f of fileList) { const a = aidOf(f); if (a && !byAid.has(a)) byAid.set(a, f); }

  for (const b of blocks) {
    const cid = cidOf(b);
    const exact = cid ? byAid.get(cid) : null;
    if (exact) { give(exact, b); continue; }
    const name = nameOf(b), tb = t(b);
    if (!name || !Number.isFinite(tb)) continue;
    let best = null;
    for (const f of fileList) {
      if (cid && aidOf(f)) continue; // both keyed and they disagree — never guessed
      if (f.machine_id !== b.machine_id || f.ai_service !== b.ai_service || nameOf(f) !== name) continue;
      const dt = Math.abs(t(f) - tb);
      if (!Number.isFinite(dt) || dt > FILE_BLOCK_WINDOW_MS) continue;
      if (!best || dt < best.dt) best = { dt, f };
    }
    if (best) give(best.f, b);
  }
  return out;
}

/**
 * Concatenate event lists, keeping the first occurrence of each id. A null /
 * non-array list (a failed fetch leg) contributes nothing, so a failed
 * file-block leg falls back to whatever blocks the other lists carry.
 */
export function mergeEventsById(...lists) {
  const out = [], ids = new Set();
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const ev of list) {
      if (!ev || ev.id == null || ids.has(ev.id)) continue;
      ids.add(ev.id); out.push(ev);
    }
  }
  return out;
}

/** "N send attempts stopped", or null when nothing paired. */
export function attemptsLabel(n) {
  if (!n) return null;
  return `${n} send attempt${n === 1 ? "" : "s"} stopped`;
}

export const HOLD_REASON_LABELS = {
  cloud_reference: "Cloud file (not scanned)",
  partially_scanned: "Partially scanned (large file)",
  unverified: "Could not be scanned",
  not_found: "File not found on disk",
};
export function holdReasonLabel(r) {
  const s = str(r);
  if (!s) return null;
  return Object.prototype.hasOwnProperty.call(HOLD_REASON_LABELS, s) ? HOLD_REASON_LABELS[s] : s.slice(0, 200);
}

/** Distinct pattern names found in the file's content scan. */
export function filePatterns(f) {
  const m = metaOf(f);
  const pats = new Set();
  const add = p => { const s = str(p); if (s) pats.add(s.slice(0, 100)); };
  const cs = m?.content_scan;
  if (cs && Array.isArray(cs.matches)) for (const x of cs.matches) add(typeof x === "string" ? x : x?.pattern);
  const extra = m?.matched_patterns ?? m?.patterns;
  if (Array.isArray(extra)) extra.forEach(add);
  else if (typeof extra === "string") extra.split(",").forEach(add);
  return [...pats];
}

/** Reason column: the matched patterns, else a readable hold reason, else null. */
export function fileReason(f) {
  const pats = filePatterns(f);
  if (pats.length) return pats.join(", ");
  return holdReasonLabel(metaOf(f)?.hold_reason);
}
