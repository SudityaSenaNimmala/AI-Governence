// Core decision logic for the MCP stdio guard ("cfai-mcp-guard").
//
// The guard sits between an MCP host (Claude Desktop, Cursor, …) and a stdio
// MCP server. It inspects every host→server JSON-RPC message and, for
// `tools/call` requests carrying sensitive data, refuses to forward the call —
// returning a JSON-RPC error to the host instead. Everything else (the
// `initialize` handshake, `tools/list`, notifications, benign calls, and ALL
// server→host traffic) passes through untouched, so the server keeps running.
//
// This module is pure (no I/O) so it can be unit-tested deterministically; the
// stdio plumbing lives in index.js.

import { scan, classifyFile } from '../os_monitor/classifier.js';
import { TokenVault } from '../proxy/token-vault.js';

const SEVERITY_ORDER = ['low', 'moderate', 'high', 'critical'];
export function sevRank(s) {
  const i = SEVERITY_ORDER.indexOf(s);
  return i < 0 ? -1 : i;
}

// Argument keys whose string values we treat as file references and run through
// the filename classifier (catches "read ~/.env", "upload secrets.csv", etc.).
const PATH_KEYS = new Set([
  'path', 'paths', 'file', 'files', 'filename', 'filepath', 'file_path',
  'uri', 'url', 'source', 'destination', 'dest', 'target', 'location',
]);

// A bare string that still looks like a filesystem path (has a separator and a
// trailing extension) — so we catch paths even under non-standard arg keys.
function looksLikePath(s) {
  return typeof s === 'string' && /[\\/]/.test(s) && /\.\w{1,8}$/.test(s.trim());
}

// Walk an arbitrary JSON value, collecting every string (for content scanning)
// and every value that looks like a file path (for filename classification).
function collect(val, key, acc) {
  if (typeof val === 'string') {
    acc.text.push(val);
    const keyed = key != null && PATH_KEYS.has(String(key).toLowerCase());
    if (keyed || looksLikePath(val)) acc.paths.push(val);
  } else if (Array.isArray(val)) {
    for (const v of val) collect(v, key, acc);
  } else if (val && typeof val === 'object') {
    for (const [k, v] of Object.entries(val)) collect(v, k, acc);
  }
}

// Inspect a parsed JSON-RPC message. Returns null when there's nothing to act
// on (not a tools/call, or no sensitive signal); otherwise returns the verdict
// with matched pattern names + the highest severity found.
export function inspectMessage(msg) {
  if (!msg || msg.method !== 'tools/call' || !msg.params) return null;

  const acc = { text: [], paths: [] };
  collect(msg.params.arguments ?? {}, null, acc);

  const joined = acc.text.join('\n');
  const { matches } = scan(joined);
  const all = [...matches];

  // Filename-based signals (sensitive file *being sent through* the tool call).
  const seenFiles = new Set();
  for (const p of acc.paths) {
    const basename = (p.split(/[\\/]/).pop() || p).trim();
    if (!basename || seenFiles.has(basename)) continue;
    seenFiles.add(basename);
    const fc = classifyFile(basename);
    // Only flag files that carry real risk — skip low-severity types
    // (plain text, source code, images, media) so benign paths don't trip.
    if (fc && fc.class !== 'other' && fc.severity !== 'low') {
      all.push({
        pattern: `file:${fc.class}`,
        class: 'file',
        severity: fc.severity,
        count: 1,
        filename: basename,
        reason: fc.reason,
      });
    }
  }

  if (all.length === 0) return null;

  let highest = null;
  for (const m of all) if (sevRank(m.severity) > sevRank(highest)) highest = m.severity;

  return {
    toolName: msg.params.name || null,
    matches: all,
    highestSeverity: highest,
    scannedLength: joined.length,
  };
}

// Block when the worst signal meets or exceeds the threshold (default: block
// high + critical, matching the HTTPS proxy and keystroke enforcer).
export function shouldBlock(inspection, threshold = 'high') {
  if (!inspection) return false;
  return sevRank(inspection.highestSeverity) >= sevRank(threshold);
}

// Decide whether to tokenize instead of block. Returns true when ALL matched
// patterns are in the tokenize set (none need hard blocking).
export function shouldTokenize(inspection, tokenizePatterns, threshold = 'high') {
  if (!inspection || !tokenizePatterns || tokenizePatterns.size === 0) return false;
  if (sevRank(inspection.highestSeverity) < sevRank(threshold)) return false;
  // ALL matches at-or-above threshold must be in the tokenize set
  return inspection.matches
    .filter((m) => sevRank(m.severity) >= sevRank(threshold))
    .every((m) => tokenizePatterns.has(m.pattern));
}

// Tokenize a JSON-RPC tools/call message in-place. Replaces sensitive values
// in the arguments with reversible tokens. Returns the modified message JSON
// string and the count of tokenized values.
export function tokenizeMessage(msg, vault, tokenizePatterns) {
  if (!msg || msg.method !== 'tools/call' || !msg.params) return null;

  const REGEXES = {
    'openai-api-key': /\b(sk-(?:proj-)?[A-Za-z0-9_-]{20,})\b/g,
    'anthropic-api-key': /\b(sk-ant-(?:api\d{2}-)?[A-Za-z0-9_-]{20,})\b/g,
    'google-api-key': /\b(AIza[0-9A-Za-z_-]{30,})\b/g,
    'huggingface-token': /\b(hf_[A-Za-z0-9]{30,})\b/g,
    'github-pat': /\b(gh[pousr]_[A-Za-z0-9]{30,})\b/g,
    'gitlab-pat': /\b(glpat-[A-Za-z0-9_-]{20,})\b/g,
    'aws-access-key': /\b(AKIA[0-9A-Z]{16})\b/g,
    'slack-token': /\b(xox[abprs]-[A-Za-z0-9-]{10,})\b/g,
    'jwt': /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
    'us-ssn': /\b\d{3}-\d{2}-\d{4}\b/g,
    'credit-card': /\b(?:\d[ -]*?){13,16}\b/g,
    'iban': /\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/g,
    'us-phone': /\b(?:\+?1[ -]?)?\(?[2-9]\d{2}\)?[ -]?\d{3}[ -]?\d{4}\b/g,
    'cloudfuze-customer-id': /\bCF-CUST-[A-Z0-9]{6,}\b/g,
    'internal-jira-key': /\b(CF|GOV|SEC)-\d{2,}\b/g,
  };

  let tokenCount = 0;
  const copy = JSON.parse(JSON.stringify(msg)); // deep clone

  function walkAndTokenize(val, key) {
    if (typeof val === 'string') {
      let result = val;
      for (const patName of tokenizePatterns) {
        const rx = REGEXES[patName];
        if (!rx) continue;
        rx.lastIndex = 0;
        result = result.replace(rx, (match) => {
          tokenCount++;
          return vault.create(match, patName);
        });
      }
      return result;
    }
    if (Array.isArray(val)) return val.map((v, i) => walkAndTokenize(v, i));
    if (val && typeof val === 'object') {
      const out = {};
      for (const [k, v] of Object.entries(val)) out[k] = walkAndTokenize(v, k);
      return out;
    }
    return val;
  }

  copy.params.arguments = walkAndTokenize(copy.params.arguments ?? {}, null);
  return tokenCount > 0 ? { message: copy, tokenCount } : null;
}

// JSON-RPC error returned to the host in place of the blocked call. Uses a
// distinct code so the agent/UI can recognise a policy block vs a real error.
export const BLOCK_ERROR_CODE = -32001;
export function blockResponse(msg, inspection) {
  const patterns = inspection.matches.map((m) => m.pattern).join(', ');
  return {
    jsonrpc: '2.0',
    id: msg?.id ?? null,
    error: {
      code: BLOCK_ERROR_CODE,
      message:
        `Blocked by CloudFuze AI Governance: tool call "${inspection.toolName || '?'}" ` +
        `contained sensitive data (${patterns}). Remove the sensitive content and retry.`,
      data: {
        blockedBy: 'cloudfuze-mcp-guard',
        severity: inspection.highestSeverity,
        patterns: inspection.matches.map((m) => m.pattern),
      },
    },
  };
}

// Re-export TokenVault for index.js
export { TokenVault };
