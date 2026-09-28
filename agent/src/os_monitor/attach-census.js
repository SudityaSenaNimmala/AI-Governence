// The composer census — Node half (2026-09-28; security review same day).
//
// enforcer-win.ps1 reads which attachment chips a GOVERNED composer's draft
// holds (see UpdateAttachCensus / ATTACH_CENSUS_SURFACES) and emits
// {"kind":"attachcensus", surface_key, readable, names:[...]}. This module is the
// pure part of turning those chip names into files on disk:
//
//   * chipToFilename()      — a chip / dismiss-button label -> the file's name;
//   * nameVariants()        — Teams' " N" copy suffix ("secrets 1.txt" is what
//                             Teams shows when secrets.txt already exists in the
//                             user's OneDrive) -> the local names it may be;
//   * PathHints             — real paths seen recently (file pickers, CF_HDROP,
//                             the chip watcher), with WHO they were seen for;
//   * parseLnkTarget()      — the local target of a Recent\<name>.lnk shortcut;
//   * resolveAttachment()   — name -> { status:'local', path, trust } |
//                             { status:'cloud' } | { status:'not_found' }.
//
// TRUST (security review 2026-09-28, finding 2). A chip carries only a NAME, and
// a name alone cannot say which file on this disk the user attached: reading
// (and uploading) whatever same-named file a folder search finds would ship an
// UNRELATED file's contents to the server. So a resolution is only
// trust:'bound' -- content may be read -- when the path was observed being
// handed to THIS app (a picker or pane picker for this process / pid, or a
// CF_HDROP copy while it was focused) within BOUND_HINT_WINDOW_MS, and the file
// still has the size and mtime it had then. Every other match (Recent .lnk,
// folder search, OneDrive, an unbound or stale hint) is trust:'weak': the caller
// reports METADATA ONLY and, on an enforcing surface, holds it as 'unverified'.
//
// NEVER opens a Files-On-Demand placeholder: EVERY candidate path's attribute
// word is checked (not only under a known OneDrive root -- synced SharePoint
// libraries live elsewhere) before it is treated as local. Nothing here logs a
// name or a path.

import { existsSync, readdirSync, statSync, readFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';
import { execFile } from 'node:child_process';

const REMOVE_PREFIX = /^remove attachment\s*/i;

// How long after a picker / CF_HDROP a hint may bind a census name to a path.
export const BOUND_HINT_WINDOW_MS = 2 * 60_000;

// "Remove attachment secrets.txt" -> "secrets.txt"
// Word's primary label "txt secrets.txt secrets.txt upload finished" -> "secrets.txt"
// anything else -> trimmed as-is.
export function chipToFilename(raw) {
  let s = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  if (REMOVE_PREFIX.test(s)) s = s.replace(REMOVE_PREFIX, '').trim();
  // "<ext> <name> <name> <state...>": the name is repeated, and it ends in .<ext>.
  const m = /^(\S+) (.+?) \2(?: .*)?$/.exec(s);
  if (m && m[2].toLowerCase().endsWith('.' + m[1].toLowerCase())) return m[2];
  return s;
}

// A chip name that can safely be joined onto a folder: no separators, no
// traversal, no drive letters, no control characters. (Finding 13.)
export function safeLeafName(name) {
  const n = String(name ?? '').trim();
  if (!n || n.length > 255) return false;
  if (/[\\/:*?"<>|\u0000-\u001f]/.test(n)) return false;
  if (n === '.' || n === '..' || n.includes('..')) return false;
  return true;
}

// The names a displayed chip may correspond to on disk, EXACT FIRST: itself,
// then -- for a Teams " N" copy suffix before the extension -- the name without
// it. Callers must try every source with the exact name before any stripped one.
export function nameVariants(displayName) {
  const name = String(displayName ?? '').trim();
  if (!name) return [];
  const out = [name];
  const m = /^(.*\S) \d{1,3}(\.[^.\s]+)?$/.exec(name);
  if (m) out.push(m[1] + (m[2] || ''));
  return [...new Set(out)];
}

function statOf(path) {
  try { const st = statSync(path); return st.isFile() ? { size: st.size, mtimeMs: Math.round(st.mtimeMs) } : null; }
  catch { return null; }
}

// Real paths seen recently, keyed by lower-cased basename, remembering WHO they
// were seen for (process, pid, via) and the file's size / mtime at that moment.
export class PathHints {
  constructor({ ttlMs = 30 * 60_000, max = 200 } = {}) {
    this.ttlMs = ttlMs;
    this.max = max;
    this.map = new Map();
  }

  remember(path, via = '', { process: proc = '', pid = 0 } = {}) {
    if (!path) return;
    const key = basename(String(path)).toLowerCase();
    this.map.delete(key);
    this.map.set(key, {
      path: String(path), via, at: Date.now(),
      process: String(proc || '').replace(/\.exe$/i, '').trim().toLowerCase(), pid: Number(pid) || 0,
      stat: statOf(path),
    });
    while (this.map.size > this.max) this.map.delete(this.map.keys().next().value);
  }

  // The newest unexpired hint for EXACTLY this basename, or null.
  get(name) {
    const hit = this.map.get(String(name ?? '').toLowerCase());
    return hit && Date.now() - hit.at <= this.ttlMs ? hit : null;
  }

  // Exact name first, then the stripped variant (kept for callers that only
  // need "was this seen at all").
  lookup(name) {
    for (const v of nameVariants(name)) { const h = this.get(v); if (h) return h; }
    return null;
  }

  // Is this hint BOUND to an attach into (process, pid)? Seen for that process
  // (and pid, when both sides know it), within the window, and the file is
  // unchanged since (size + mtime).
  static isBound(hint, { process: proc = '', pid = 0, windowMs = BOUND_HINT_WINDOW_MS } = {}) {
    if (!hint) return false;
    if (!['open_file_dialog', 'pane_file_dialog', 'clipboard_file_copy'].includes(hint.via)) return false;
    if (Date.now() - hint.at > windowMs) return false;
    const want = String(proc || '').replace(/\.exe$/i, '').trim().toLowerCase();
    if (!want || hint.process !== want) return false;
    if (hint.pid && pid && hint.pid !== Number(pid)) return false;
    const now = statOf(hint.path);
    if (!now || !hint.stat) return false;
    return now.size === hint.stat.size && now.mtimeMs === hint.stat.mtimeMs;
  }
}

// The local target of a Windows .lnk, or null. Only the LinkInfo structure is
// read; a shortcut without one (a shell-namespace item) yields null, and so does
// a network (UNC) target. The Unicode base path is preferred when present
// (LinkInfoHeaderSize >= 0x24). Pure: takes the file's bytes.
export function parseLnkTarget(buf) {
  try {
    if (!buf || buf.length < 0x4c || buf.readUInt32LE(0) !== 0x4c) return null;
    const flags = buf.readUInt32LE(0x14);
    let off = 0x4c;
    if (flags & 0x1) off += 2 + buf.readUInt16LE(off);          // HasLinkTargetIDList
    if (!(flags & 0x2)) return null;                             // HasLinkInfo
    const infoStart = off;
    const headerSize = buf.readUInt32LE(infoStart + 4);
    const infoFlags = buf.readUInt32LE(infoStart + 8);
    if (!(infoFlags & 0x1)) return null;                         // VolumeIDAndLocalBasePath
    const cstr = (at) => { let e = at; while (e < buf.length && buf[e] !== 0) e++; return buf.toString('latin1', at, e); };
    const wstr = (at) => { let e = at; while (e + 1 < buf.length && (buf[e] !== 0 || buf[e + 1] !== 0)) e += 2; return buf.toString('utf16le', at, e); };
    let full = '';
    if (headerSize >= 0x24) {
      const bu = buf.readUInt32LE(infoStart + 0x1c);
      const su = buf.readUInt32LE(infoStart + 0x20);
      if (bu) full = wstr(infoStart + bu) + (su ? wstr(infoStart + su) : '');
    }
    if (!full) {
      const baseOff = buf.readUInt32LE(infoStart + 16);
      const suffixOff = buf.readUInt32LE(infoStart + 24);
      full = cstr(infoStart + baseOff) + (suffixOff ? cstr(infoStart + suffixOff) : '');
    }
    if (!full || full.startsWith('\\\\')) return null;            // no UNC targets
    return full;
  } catch { return null; }
}

// Every OneDrive root this user has: the environment's own, plus any
// "OneDrive*" folder directly under the profile. Informational now -- every
// candidate's attributes are checked regardless (synced SharePoint libraries
// are NOT under these roots).
export function oneDriveRoots({ env = process.env, home = homedir() } = {}) {
  const roots = new Set();
  for (const k of ['OneDrive', 'OneDriveCommercial', 'OneDriveConsumer']) if (env[k]) roots.add(env[k]);
  try {
    for (const e of readdirSync(home, { withFileTypes: true })) {
      if (e.isDirectory() && /^onedrive/i.test(e.name)) roots.add(join(home, e.name));
    }
  } catch { /* none */ }
  return [...roots];
}

// FILE_ATTRIBUTE_OFFLINE | RECALL_ON_OPEN | RECALL_ON_DATA_ACCESS
const PLACEHOLDER_BITS = 0x1000 | 0x40000 | 0x400000;

// Is this path a Files-On-Demand placeholder (bytes not local)? Asks the OS for
// the attribute word without opening the file. Any failure answers TRUE — the
// fail-closed direction: never read what might trigger a download.
export function isCloudPlaceholder(path, { timeoutMs = 3000 } = {}) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') { resolve(false); return; }
    // The path travels in an ENVIRONMENT VARIABLE, never inside the command
    // text: filenames come from a third-party app's UI and may contain any
    // character PowerShell treats as a quote (including U+2018/U+2019), so
    // interpolating them into -Command was a command injection.
    execFile('powershell', ['-NoProfile', '-NonInteractive', '-Command', '[int](Get-Item -LiteralPath $env:CFAI_ATTR_PATH -Force).Attributes'],
      { timeout: timeoutMs, windowsHide: true, env: { ...process.env, CFAI_ATTR_PATH: String(path) } }, (err, stdout) => {
        if (err) { resolve(true); return; }
        const n = Number(String(stdout).trim());
        resolve(!Number.isFinite(n) || (n & PLACEHOLDER_BITS) !== 0);
      });
  });
}

// Bounded breadth-first search for ONE exact basename under `dir`.
function findUnder(dir, wanted, { maxDepth = 2, maxEntries = 4000 } = {}) {
  const want = String(wanted).toLowerCase();
  const queue = [[dir, 0]];
  let seen = 0;
  while (queue.length) {
    const [d, depth] = queue.shift();
    let entries;
    try { entries = readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (++seen > maxEntries) return null;
      const full = join(d, e.name);
      if (e.isFile() && e.name.toLowerCase() === want) return full;
      if (e.isDirectory() && depth < maxDepth && !e.name.startsWith('.')) queue.push([full, depth + 1]);
    }
  }
  return null;
}

export function defaultSearchDirs(home = homedir()) {
  return ['Desktop', 'Downloads', 'Documents'].map((d) => join(home, d)).filter((d) => existsSync(d));
}

export function recentDir(env = process.env) {
  return env.APPDATA ? join(env.APPDATA, 'Microsoft', 'Windows', 'Recent') : '';
}

// name -> where its bytes are, and how far that answer can be trusted.
//
// Order: a BOUND hint (exact name, then the " N"-stripped name), then -- all
// trust:'weak', metadata only -- any other hint, Recent .lnk, the usual
// folders, the OneDrive roots. Every source is tried with the EXACT name before
// any source is tried with a stripped one, so a suffix strip can never map a
// chip to a different existing file when the exact name also exists.
export async function resolveAttachment(name, {
  hints = null, process: proc = '', pid = 0,
  searchDirs = defaultSearchDirs(), recent = recentDir(), roots = oneDriveRoots(),
  placeholder = isCloudPlaceholder,
} = {}) {
  const shown = chipToFilename(name);
  if (!safeLeafName(shown)) return { status: 'not_found' };
  const variants = nameVariants(shown).filter(safeLeafName);
  if (!variants.length) return { status: 'not_found' };
  const accept = async (path, source, trust) => {
    if (!path || !existsSync(path)) return null;
    if (!statOf(path)) return null;
    if (await placeholder(path)) return { status: 'cloud', source };
    return { status: 'local', path, source, trust };
  };
  // 1. BOUND hints: the only content-readable answers.
  for (const v of variants) {
    const h = hints?.get(v);
    if (h && PathHints.isBound(h, { process: proc, pid })) {
      const r = await accept(h.path, 'hint', 'bound'); if (r) return r;
    }
  }
  // 2. Everything else is weak, exact name before stripped name.
  for (const v of variants) {
    const h = hints?.get(v);
    if (h) { const r = await accept(h.path, 'hint', 'weak'); if (r) return r; }
    if (recent) {
      const lnk = join(recent, v + '.lnk');
      if (existsSync(lnk)) {
        let target = null;
        try { target = parseLnkTarget(readFileSync(lnk)); } catch { target = null; }
        const r = await accept(target, 'recent', 'weak'); if (r) return r;
      }
    }
    for (const d of searchDirs) {
      const r = await accept(findUnder(d, v), 'search', 'weak'); if (r) return r;
    }
    for (const root of roots) {
      const hit = findUnder(root, v, { maxDepth: 3, maxEntries: 6000 });
      if (hit) { const r = await accept(hit, 'onedrive', 'weak'); if (r) return r; }
    }
  }
  return { status: 'not_found' };
}
