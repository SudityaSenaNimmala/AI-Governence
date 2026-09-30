// Pure tests for the AI Activity "File Uploads" row helpers.
// Run: node --test src/Components/App/AIHub/dlpFileRows.test.mjs   (from connect-ui/)
import test from "node:test";
import assert from "node:assert/strict";
import {
  HOLD_REASON_LABELS, holdReasonLabel, fileReason, isFileUploadBlock, isProvisionalFileBlock,
  fileRowInScope, fileIsUnscannedReported, UNSCANNED_REASONS,
  fileHasContent, fileNoContentNote, fileIsWeakBinding,
  pairFileBlocks, filesWithPromptBlock, isPromptSubmitBlock, PROMPT_BLOCK_WINDOW_MS,
} from "./dlpFileRows.js";

const T0 = Date.parse("2026-09-30T10:00:00.000Z");
const at = ms => new Date(T0 + ms).toISOString();
const file = (id, meta = {}, extra = {}) => ({ id, machine_id: "m1", ai_service: "Microsoft Teams", occurred_at: at(0), metadata: { filename: "a.pdf", ...meta }, ...extra });
const fileBlock = (id, ms, extra = {}) => ({ id, event_kind: "enforcement_block", blocked_for: "file_upload", machine_id: "m1", ai_service: "Microsoft Teams", occurred_at: at(ms), metadata: { filename: "a.pdf", highest_severity: "high", matches: [{ pattern: "SSN" }] }, ...extra });
const promptBlock = (id, ms, extra = {}) => ({ id, event_kind: "enforcement_block", blocked_for: "prompt_submit", machine_id: "m1", ai_service: "Microsoft Teams", occurred_at: at(ms), ...extra });

test("every agent hold_reason code has a human label, legacy codes kept", () => {
  const codes = ["sensitive_content", "unsupported_type", "too_large", "encrypted", "extraction_timeout",
    "extraction_failed", "cloud_reference", "not_found", "unverified_location", "unverified", "partially_scanned"];
  for (const c of codes) {
    assert.ok(HOLD_REASON_LABELS[c], `missing label for ${c}`);
    assert.notEqual(holdReasonLabel(c), c);
    assert.doesNotMatch(holdReasonLabel(c), /_/);
  }
  assert.equal(holdReasonLabel("unverified"), "Could not be scanned");
  assert.equal(holdReasonLabel("cloud_reference"), "Cloud file (not scanned)");
});

test("holdReasonLabel: unknown codes pass through capped, blanks are null, no prototype keys", () => {
  assert.equal(holdReasonLabel("brand_new_code"), "brand_new_code");
  assert.equal(holdReasonLabel("x".repeat(500)).length, 200);
  assert.equal(holdReasonLabel("  "), null);
  assert.equal(holdReasonLabel(null), null);
  assert.equal(holdReasonLabel("toString"), "toString");
});

test("fileReason prefers patterns, else the labelled hold reason (metadata or metadata_json)", () => {
  assert.equal(fileReason(file(1, { hold_reason: "encrypted" })), "Encrypted or password-protected");
  assert.equal(fileReason({ id: 2, metadata_json: JSON.stringify({ hold_reason: "too_large" }) }), "Too large to scan");
  assert.equal(fileReason(file(3, { hold_reason: "sensitive_content", matched_patterns: ["SSN", "API key"] })), "SSN, API key");
  assert.equal(fileReason(file(4)), null);
});

test("scope: high/critical and held rows always shown; unscanned allowed rows only on opt-in", () => {
  const hi = file(1, {}, { severity: "high" });
  const heldLow = file(2, { enforcement: "held", hold_reason: "cloud_reference" }, { severity: "low" });
  const allowedEncrypted = file(3, { enforcement: "reported", hold_reason: "encrypted" }, { severity: "low" });
  const allowedNoSev = file(4, { enforcement: "reported", hold_reason: "not_found" });
  const allowedClean = file(5, { enforcement: "reported" }, { severity: "low" });
  const allowedUnknownReason = file(6, { enforcement: "reported", hold_reason: "something_else" });
  const allowedSensitiveLow = file(7, { enforcement: "reported", hold_reason: "sensitive_content" }, { severity: "low" });

  for (const f of [hi, heldLow]) {
    assert.equal(fileRowInScope(f), true);
    assert.equal(fileRowInScope(f, { includeUnscanned: true }), true);
    assert.equal(fileIsUnscannedReported(f), false);
  }
  for (const f of [allowedEncrypted, allowedNoSev]) {
    assert.equal(fileRowInScope(f), false, "hidden by default");
    assert.equal(fileRowInScope(f, { includeUnscanned: true }), true);
    assert.equal(fileIsUnscannedReported(f), true);
  }
  for (const f of [allowedClean, allowedUnknownReason, allowedSensitiveLow]) {
    assert.equal(fileRowInScope(f, { includeUnscanned: true }), false);
  }
  // Array.filter passes (item, index) — the index must not be read as opts.
  assert.deepEqual([allowedEncrypted].filter(fileRowInScope), []);
  assert.ok(!UNSCANNED_REASONS.has("sensitive_content"));
});

test("content: rows without has_content get a note instead of a View button", () => {
  assert.equal(fileHasContent({ has_content: true }), true);
  assert.equal(fileHasContent({ has_content: 1 }), true);
  assert.equal(fileHasContent({ has_content: false }), false);
  assert.equal(fileNoContentNote(file(1, {}, { has_content: true })), null);
  const plain = fileNoContentNote(file(2, {}, { has_content: false }));
  assert.equal(plain.label, "Content not captured");
  const weak = fileNoContentNote(file(3, { binding: "weak" }));
  assert.equal(weak.label, "Content not captured");
  assert.match(weak.title, /could not confirm/i);
  assert.equal(fileIsWeakBinding(file(4, { binding: "weak" })), true);
  assert.equal(fileIsWeakBinding(file(5, { binding: "bound" })), false);
});

test("isPromptSubmitBlock reads blocked_for top-level or from metadata", () => {
  assert.equal(isPromptSubmitBlock(promptBlock(1, 0)), true);
  assert.equal(isPromptSubmitBlock({ event_kind: "enforcement_block", metadata: { blocked_for: "prompt_submit" } }), true);
  assert.equal(isPromptSubmitBlock(fileBlock(2, 0)), false);
  assert.equal(isPromptSubmitBlock({ event_kind: "prompt_submit", blocked_for: "prompt_submit" }), false);
});

test("'Also blocked: prompt text' pairs within ±5 s on same machine + service only", () => {
  const f = file("f1");
  const blocks = pairFileBlocks([f], [fileBlock("b1", 1000)]);
  assert.equal(blocks.get("f1").length, 1);

  assert.ok(filesWithPromptBlock(blocks, [promptBlock("p1", 1000 + PROMPT_BLOCK_WINDOW_MS)]).has("f1"), "edge +5s");
  assert.ok(filesWithPromptBlock(blocks, [promptBlock("p1", 1000 - PROMPT_BLOCK_WINDOW_MS)]).has("f1"), "edge -5s");
  assert.ok(!filesWithPromptBlock(blocks, [promptBlock("p1", 1000 + PROMPT_BLOCK_WINDOW_MS + 1)]).has("f1"), "outside window");
  assert.ok(!filesWithPromptBlock(blocks, [promptBlock("p1", 1000, { machine_id: "m2" })]).has("f1"), "other machine");
  assert.ok(!filesWithPromptBlock(blocks, [promptBlock("p1", 1000, { ai_service: "ChatGPT" })]).has("f1"), "other service");
  assert.ok(!filesWithPromptBlock(blocks, [fileBlock("b2", 1000)]).has("f1"), "a file block is not a prompt block");
  assert.ok(!filesWithPromptBlock(blocks, [promptBlock("p1", 1000, { machine_id: null })]).has("f1"), "no machine id never pairs");
});

test("'Also blocked' needs a paired file block — a file with none never shows it", () => {
  const out = filesWithPromptBlock(pairFileBlocks([file("f1")], []), [promptBlock("p1", 0)]);
  assert.equal(out.size, 0);
  assert.equal(filesWithPromptBlock(null, [promptBlock("p1", 0)]).size, 0);
  assert.equal(filesWithPromptBlock(new Map([["f1", [fileBlock("b1", 0)]]]), null).size, 0);
});

test("S4: scanned-but-qualified reasons are not 'Not scanned'; the new agent codes have labels", () => {
  for (const r of ["unverified_location", "partially_scanned"]) {
    assert.equal(UNSCANNED_REASONS.has(r), false, r);
    assert.equal(fileIsUnscannedReported(file(1, { enforcement: "reported", hold_reason: r })), false, r);
  }
  assert.equal(holdReasonLabel("unverified_location"), "Scanned (file location unconfirmed)");
  assert.equal(holdReasonLabel("partially_scanned"), "Partially scanned");
  assert.equal(holdReasonLabel("sensitive_filename"), "Credential or key file");
  assert.equal(holdReasonLabel("suspicious_unscannable"), "Blocked: could not be safely scanned");
  assert.equal(holdReasonLabel("placeholder_check_failed"), "Could not check whether the file is local");
  assert.ok(UNSCANNED_REASONS.has("placeholder_check_failed"));
  // a held credential / suspicious file is always in scope
  for (const r of ["sensitive_filename", "suspicious_unscannable"]) {
    assert.equal(fileRowInScope(file(2, { enforcement: "held", hold_reason: r }, { severity: "low" })), true, r);
  }
});

test("S5: a provisional ('still checking') file block is never paired or counted", () => {
  const scanning = fileBlock("s1", 1000, { metadata: { filename: "a.pdf", attach_state: "scanning" } });
  const bare = fileBlock("s2", 1000, { metadata: { filename: "a.pdf" } });   // server dropped attach_state
  const real = fileBlock("b1", 2000);
  assert.equal(isProvisionalFileBlock(scanning), true);
  assert.equal(isProvisionalFileBlock(bare), true, 'no matches + no severity = provisional');
  assert.equal(isProvisionalFileBlock(real), false);
  assert.equal(isFileUploadBlock(scanning), false);
  const paired = pairFileBlocks([file("f1")], [scanning, bare, real]);
  assert.deepEqual(paired.get("f1").map((b) => b.id), ["b1"]);
  assert.equal(pairFileBlocks([file("f1")], [scanning, bare]).size, 0);
});
