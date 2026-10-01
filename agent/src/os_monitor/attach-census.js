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
// may scan it LOCALLY (to hold a sensitive namesake) but never uploads its
// content, and reports a clean one as 'unverified_location' (2026-09-30).
//
// NEVER opens a Files-On-Demand placeholder: EVERY candidate path's attribute
// word is checked (not only under a known OneDrive root -- synced SharePoint
// libraries live elsewhere) before it is treated as local. Nothing here logs a
// name or a path.

import { existsSync, readdirSync, statSync, readFileSync, unlinkSync } from 'node:fs';
import { join, basename, dirname, resolve as resolvePath } from 'node:path';
import { homedir } from 'node:os';
import { execFile } from 'node:child_process';

const REMOVE_PREFIX = /^remove attachment\s*/i;

// Every `via` that proves a path was handed to THIS app (see PathHints.isBound).
// 'clipboard_image' (2026-09-30): a screenshot / image pasted with Ctrl+V into a
// census surface. The helper saved the clipboard image to a private temp file
// (pasteImageDir) at the moment of the paste, for that process / pid, so the
// temp file IS the pasted bytes -- as bound as a picker path.
export const BOUND_VIAS = ['open_file_dialog', 'pane_file_dialog', 'clipboard_file_copy', 'clipboard_image'];

// %LOCALAPPDATA%\cloudfuze-aigov\paste -- where enforcer-win.ps1 saves pasted
// clipboard images. Per-user (LOCALAPPDATA's own ACL); '' when unknown.
export function pasteImageDir(env = process.env) {
  return env.LOCALAPPDATA ? join(env.LOCALAPPDATA, 'cloudfuze-aigov', 'paste') : '';
}

// Is `path` a file DIRECTLY inside the paste dir, named the way the helper names
// them (<uuid>.png / <uuid>.bmp)? Anything else is refused: a pastehint line
// must never be able to bind -- or get us to delete -- an arbitrary path.
export function isPasteImagePath(path, dir = pasteImageDir()) {
  if (!path || !dir) return false;
  const full = resolvePath(String(path));
  if (dirname(full).toLowerCase() !== resolvePath(dir).toLowerCase()) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|bmp)$/i.test(basename(full));
}

// Delete one pasted-image temp file. Only ever a paste-dir file; errors ignored.
export function removePasteImage(path, dir = pasteImageDir()) {
  if (!isPasteImagePath(path, dir)) return false;
  try { unlinkSync(path); return true; } catch { return false; }
}

// Remove paste-dir files older than `olderThanMs` (0 = all of them): the
// startup sweep, and the per-paste sweep of pastes no chip ever claimed.
export function sweepPasteDir({ dir = pasteImageDir(), olderThanMs = 0, now = Date.now() } = {}) {
  if (!dir) return 0;
  let entries = [];
  try { entries = readdirSync(dir); } catch { return 0; }
  let n = 0;
  for (const e of entries) {
    const full = join(dir, e);
    if (!isPasteImagePath(full, dir)) continue;
    try {
      if (olderThanMs > 0 && now - statSync(full).mtimeMs < olderThanMs) continue;
      unlinkSync(full); n++;
    } catch { /* in use, or already gone */ }
  }
  return n;
}

// A chip that may be a PASTED picture: an image extension, or the generic
// labels a composer gives a pasted image.
export function isImageChipName(name) {
  const n = String(name ?? '').trim();
  return /\.(png|jpe?g|gif|bmp|webp)$/i.test(n) || isGenericPasteName(n);
}

// The generic names a composer gives a pasted picture ("image.png", "Pasted
// image", "Screenshot 2026-..."), as opposed to a real file's own name. A
// STAGED clipboard image (no paste key seen) may only bind to one of these.
export function isGenericPasteName(name) {
  const n = String(name ?? '').trim();
  return /^(pasted )?(image|screenshot)\b/i.test(n);
}

// Credential / key file types that hold on their NAME ALONE, whatever the scan
// says (user decision 2026-09-30, browser parity for the dangerous classes
// only). Name keywords ("secret-santa.txt") and the tabular class (team.csv)
// never hold by themselves.
const CREDENTIAL_EXT = /\.(pfx|p12|pem|key|ppk|kdbx|jks|keystore|npmrc|pgpass)$/i;
const CREDENTIAL_EXACT = /^(id_rsa|id_dsa|id_ecdsa|id_ed25519|\.env|\.npmrc|\.pgpass)$/i;
export function isCredentialFileName(name) {
  const n = basename(String(name ?? '').trim());
  if (!n) return false;
  return CREDENTIAL_EXACT.test(n) || CREDENTIAL_EXT.test(n) || /^\.env(\..+)?$/i.test(n) || /\.env$/i.test(n);
}

// How long after a picker / CF_HDROP a hint may bind a census name to a path.
export const BOUND_HINT_WINDOW_MS = 2 * 60_000;
// A paste KEY binds only to an image chip that appears within this long after it.
export const CLIPBOARD_BIND_MS = 10_000;
// Helper clock vs Node clock, and a chip first seen on the paste's own tick.
export const CLIPBOARD_CLOCK_SKEW_MS = 500;

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

  // `pastedAt` / `staged`: clipboard_image hints only -- when the paste (or,
  // staged, the clipboard change) happened, by the helper's clock.
  remember(path, via = '', { process: proc = '', pid = 0, pastedAt = 0, staged = false } = {}) {
    if (!path) return;
    const key = basename(String(path)).toLowerCase();
    this.map.delete(key);
    this.map.set(key, {
      path: String(path), via, at: Date.now(),
      process: String(proc || '').replace(/\.exe$/i, '').trim().toLowerCase(), pid: Number(pid) || 0,
      stat: statOf(path),
      pastedAt: Number(pastedAt) || 0, staged: staged === true,
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

  // The OLDEST unclaimed pasted image bound to (process, pid), taken OUT of the
  // table so one paste binds at most one chip. A pasted image's chip is named
  // by the app ("image.png"), never by our temp file, so it is matched by
  // "the next new image-type chip", not by name.
  //
  // ONLY a paste that happened BEFORE the chip appeared (`appearedAt`, allowing
  // a little clock skew), and recently: CLIPBOARD_BIND_MS for a paste key,
  // BOUND_HINT_WINDOW_MS for a staged clipboard change -- and a staged image
  // only for a generically named chip, so it can never claim a dragged
  // "photo.png". Once one is claimed, every OLDER unclaimed paste for the same
  // app is stale and comes back in `dropped` (the caller deletes the files).
  takeClipboardImage({ process: proc = '', pid = 0, appearedAt = Date.now(), chipName = '' } = {}) {
    const want = String(proc || '').replace(/\.exe$/i, '').trim().toLowerCase();
    const eligible = [];
    for (const [k, h] of this.map) {
      if (h.via !== 'clipboard_image' || h.process !== want) continue;
      if (!PathHints.isBound(h, { process: proc, pid })) continue;
      const pastedAt = h.pastedAt || h.at;
      if (pastedAt > appearedAt + CLIPBOARD_CLOCK_SKEW_MS) continue;   // pasted after the chip appeared
      if (appearedAt - pastedAt > (h.staged ? BOUND_HINT_WINDOW_MS : CLIPBOARD_BIND_MS)) continue;
      if (h.staged && !isGenericPasteName(chipName)) continue;
      eligible.push([k, h, pastedAt]);
    }
    if (!eligible.length) return null;
    eligible.sort((a, b) => a[2] - b[2]);
    const [k, h, at] = eligible[0];
    this.map.delete(k);
    const dropped = [];
    for (const [k2, h2] of [...this.map]) {
      if (h2.via === 'clipboard_image' && h2.process === want && (h2.pastedAt || h2.at) < at) {
        this.map.delete(k2); dropped.push(h2.path);
      }
    }
    return { ...h, dropped };
  }

  // Forget clipboard image hints for this app (a paste key makes a staged one
  // stale); returns their paths for deletion.
  dropClipboardImages({ process: proc = '', stagedOnly = false } = {}) {
    const want = String(proc || '').replace(/\.exe$/i, '').trim().toLowerCase();
    const dropped = [];
    for (const [k, h] of [...this.map]) {
      if (h.via !== 'clipboard_image' || h.process !== want || (stagedOnly && !h.staged)) continue;
      this.map.delete(k); dropped.push(h.path);
    }
    return dropped;
  }

  // Is this hint BOUND to an attach into (process, pid)? Seen for that process
  // (and pid, when both sides know it), within the window, and the file is
  // unchanged since (size + mtime).
  static isBound(hint, { process: proc = '', pid = 0, windowMs = BOUND_HINT_WINDOW_MS } = {}) {
    if (!hint) return false;
    if (!BOUND_VIAS.includes(hint.via)) return false;
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
// the attribute word without opening the file. Any failure answers 'error'
// (truthy, so a caller that only tests truthiness still never reads the file);
// resolveAttachment reports it as placeholder_check_failed, not as a cloud file.
export function isCloudPlaceholder(path, { timeoutMs = 3000 } = {}) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') { resolve(false); return; }
    // The path travels in an ENVIRONMENT VARIABLE, never inside the command
    // text: filenames come from a third-party app's UI and may contain any
    // character PowerShell treats as a quote (including U+2018/U+2019), so
    // interpolating them into -Command was a command injection.
    execFile('powershell', ['-NoProfile', '-NonInteractive', '-Command', '[int](Get-Item -LiteralPath $env:CFAI_ATTR_PATH -Force).Attributes'],
      { timeout: timeoutMs, windowsHide: true, env: { ...process.env, CFAI_ATTR_PATH: String(path) } }, (err, stdout) => {
        if (err) { resolve('error'); return; }
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
    const ph = await placeholder(path);
    if (ph === 'error') return { status: 'placeholder_check_failed', source };
    if (ph) return { status: 'cloud', source };
    return { status: 'local', path, source, trust };
  };
  // 1. BOUND hints: the only content-readable answers. (Pasted images are bound
  //    by index.js before this is called -- see #resolveClipboardImage.)
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
