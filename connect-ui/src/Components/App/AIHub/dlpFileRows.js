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
 * hold_reason codes that mean "this file could not be (fully) verified" rather
 * than "this file is sensitive". A file REPORTED (not held) with one of these
 * went out unscanned — a blind spot an admin can ask to see, but not a finding.
 * Only known codes count: an arbitrary string never widens the table's scope.
 */
// NOT here: unverified_location (the file WAS scanned -- only its location is
// unconfirmed) and partially_scanned (the first part was scanned). Both are
// scanned results, not blind spots.
export const UNSCANNED_REASONS = new Set([
  "unsupported_type", "too_large", "encrypted", "extraction_timeout",
  "extraction_failed", "cloud_reference", "not_found", "placeholder_check_failed",
  "unverified",
]);

function isHiCritFile(f) {
  return HI_CRIT.has(String(f?.severity || f?.highest_severity || "").toLowerCase());
}

/** The row's hold_reason, trimmed, or null. */
export function fileHoldReason(f) { return str(metaOf(f)?.hold_reason); }

/**
 * An allowed (reported, not held) upload the agent could not verify, and which
 * carries no high/critical finding of its own. Shown only on request.
 */
export function fileIsUnscannedReported(f) {
  if (fileIsHeld(f) || isHiCritFile(f)) return false;
  const r = fileHoldReason(f);
  return !!r && UNSCANNED_REASONS.has(r);
}

/**
 * Which file rows the table shows: high/critical severity, PLUS every held
 * file — a fail-closed hold (cloud reference, unreadable file) can carry low or
 * no severity, and a blocked file must never be invisible on this screen.
 * With { includeUnscanned: true }, also allowed uploads that could not be
 * scanned (fileIsUnscannedReported) — opt-in, so the default view and every
 * count derived from it stay "findings + blocks".
 */
export function fileRowInScope(f, opts) {
  if (isHiCritFile(f) || fileIsHeld(f)) return true;
  return !!opts?.includeUnscanned && fileIsUnscannedReported(f);
}

/**
 * A PROVISIONAL attachment block: the agent was still checking the file when
 * the send was stopped (attach_state "scanning"; older servers drop that key,
 * so also a block with no matches and no highest_severity -- the agent sends
 * both empty for exactly this case). Not a finding, never a "stopped" count.
 */
export function isProvisionalFileBlock(ev) {
  const m = metaOf(ev);
  const state = ev?.attach_state ?? m?.attach_state;
  if (state === "scanning") return true;
  const sev = ev?.highest_severity ?? m?.highest_severity;
  const matches = ev?.matches ?? m?.matches;
  return (sev == null || sev === "") && (!Array.isArray(matches) || matches.length === 0);
}

/** An enforcement_block whose subject was a file attachment, not a prompt (provisional ones excluded). */
export function isFileUploadBlock(ev) {
  if (ev?.event_kind !== "enforcement_block") return false;
  const bf = ev.blocked_for ?? metaOf(ev)?.blocked_for;
  return bf === "file_upload" && !isProvisionalFileBlock(ev);
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
  sensitive_content: "Sensitive content found",
  sensitive_filename: "Credential or key file",
  suspicious_unscannable: "Blocked: could not be safely scanned",
  placeholder_check_failed: "Could not check whether the file is local",
  unsupported_type: "File type can't be scanned",
  too_large: "Too large to scan",
  encrypted: "Encrypted or password-protected",
  extraction_timeout: "Scan timed out",
  extraction_failed: "Could not read file contents",
  cloud_reference: "Cloud file (not scanned)",
  not_found: "File not found on disk",
  unverified_location: "Scanned (file location unconfirmed)",
  partially_scanned: "Partially scanned",
  unverified: "Could not be scanned", // legacy code, before the split above
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

/** True when the agent matched this file to a disk path only weakly (metadata only). */
export function fileIsWeakBinding(f) {
  const m = metaOf(f);
  return (m?.binding ?? f?.binding) === "weak";
}

/** has_content as the API sends it (boolean, or 1 from older rows). */
export function fileHasContent(f) { return f?.has_content === true || f?.has_content === 1; }

/**
 * What the View column says for a row with no stored content: a label and a
 * one-line explanation. null when the row has content (render the View button).
 */
export function fileNoContentNote(f) {
  if (fileHasContent(f)) return null;
  if (fileIsWeakBinding(f)) {
    return { label: "Content not captured", title: "The agent could not confirm which file on disk was attached, so only the filename was recorded." };
  }
  return { label: "Content not captured", title: "No file contents were stored for this upload, only its metadata." };
}

// ±5 s: a prompt block and a file block from one Send are raised by the same
// keystroke, so anything further apart is a different attempt.
export const PROMPT_BLOCK_WINDOW_MS = 5 * 1000;

/** An enforcement_block whose subject was the prompt text. */
export function isPromptSubmitBlock(ev) {
  if (ev?.event_kind !== "enforcement_block") return false;
  const bf = ev.blocked_for ?? metaOf(ev)?.blocked_for;
  return bf === "prompt_submit";
}

/**
 * Files whose Send also had its prompt text blocked: for each file with paired
 * file-upload blocks (pairFileBlocks' output), a prompt_submit block on the
 * same machine_id + ai_service within ±PROMPT_BLOCK_WINDOW_MS of any of them.
 * Returns Set<fileId>. Display only — never a row, never a count.
 */
export function filesWithPromptBlock(fileBlocks, events) {
  const out = new Set();
  if (!fileBlocks || !fileBlocks.size) return out;
  const t = e => new Date(e?.occurred_at).getTime();
  const prompts = (events || []).filter(e => isPromptSubmitBlock(e) && e.machine_id != null && Number.isFinite(t(e)));
  if (!prompts.length) return out;
  for (const [fid, blocks] of fileBlocks) {
    const hit = (blocks || []).some(b => {
      const tb = t(b);
      if (!Number.isFinite(tb) || b.machine_id == null) return false;
      return prompts.some(p => p.machine_id === b.machine_id && p.ai_service === b.ai_service
        && Math.abs(t(p) - tb) <= PROMPT_BLOCK_WINDOW_MS);
    });
    if (hit) out.add(fid);
  }
  return out;
}
