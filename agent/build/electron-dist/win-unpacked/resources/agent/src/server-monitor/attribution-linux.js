// Linux /proc attribution.
//
// Given a PID, build a complete attribution record:
//   - user / loginuid (real human, survives sudo)
//   - cmdline (what the agent is — `python myagent.py`)
//   - cwd (which project directory)
//   - parent chain → trigger source (interactive shell vs cron vs systemd vs CI)
//
// All reads are best-effort: a process can exit between connection accept and
// /proc read, so every field can come back null. Callers must tolerate that.

import fs from 'node:fs/promises';
import path from 'node:path';

const PROC = '/proc';

// Map of process names we recognize as trigger sources. Order matters — first
// match in the parent chain wins, e.g. `python` running under `cron` should
// be tagged as `cron`, not `python`.
const TRIGGER_NAMES = [
  { match: /^crond?$/,                  source: 'cron' },
  { match: /^systemd$/,                 source: 'systemd' },
  { match: /^sshd:?$/,                  source: 'ssh' },
  { match: /^login$/,                   source: 'login' },
  { match: /^bash$|^zsh$|^sh$|^fish$/,  source: 'interactive_shell' },
  { match: /gitlab-runner|github-runner|jenkins|buildkite/, source: 'ci' },
  { match: /^docker(d)?$|^containerd$/, source: 'container' },
];

export async function attribute(pid) {
  if (!Number.isFinite(pid) || pid <= 0) return null;
  const out = {
    pid,
    uid: null,
    loginuid: null,
    user: null,         // resolved name from /etc/passwd
    cmdline: null,
    exe: null,
    cwd: null,
    parent_chain: [],
    trigger_source: null,
    started_at: null,
  };

  const base = path.join(PROC, String(pid));

  // status: contains Uid: line — use the real uid (first column)
  const status = await readFileSafe(path.join(base, 'status'));
  if (status) {
    const m = status.match(/^Uid:\s+(\d+)/m);
    if (m) out.uid = Number(m[1]);
  }

  // loginuid: the audit subsystem's "who logged in originally" — survives sudo.
  // Value is decimal; 4294967295 (= -1 as u32) means "no login" (kernel thread,
  // systemd-launched service with no human originator).
  const loginuidRaw = await readFileSafe(path.join(base, 'loginuid'));
  if (loginuidRaw) {
    const v = Number(loginuidRaw.trim());
    if (Number.isFinite(v) && v !== 4294967295) out.loginuid = v;
  }

  // Resolve uid → username. We read /etc/passwd directly because the daemon
  // may not link against libnss.
  if (out.loginuid != null) {
    out.user = await uidToName(out.loginuid);
  } else if (out.uid != null) {
    out.user = await uidToName(out.uid);
  }

  // cmdline: NUL-separated argv. Replace NULs with spaces for display, but
  // also keep the argv array for cases where the dashboard wants it.
  const cmdlineRaw = await readFileSafe(path.join(base, 'cmdline'));
  if (cmdlineRaw) {
    const argv = cmdlineRaw.split('\0').filter((s) => s.length > 0);
    out.cmdline = argv.join(' ');
  }

  // exe: symlink to the executable. Lets us distinguish `python myagent.py`
  // from `/opt/myorg/bin/agent` even if cmdline was rewritten.
  try {
    out.exe = await fs.readlink(path.join(base, 'exe'));
  } catch {}

  // cwd: working directory — tells us which project the agent was run from.
  try {
    out.cwd = await fs.readlink(path.join(base, 'cwd'));
  } catch {}

  // Walk parent chain. Stop at PID 1 (init/systemd) or at 8 levels.
  const seen = new Set([pid]);
  let cursor = pid;
  for (let i = 0; i < 8; i++) {
    const stat = await readFileSafe(path.join(PROC, String(cursor), 'stat'));
    if (!stat) break;
    // Format: "PID (comm) state PPID ..."  — comm may contain spaces/parens,
    // so we slice between the FIRST '(' and the LAST ')'.
    const lp = stat.indexOf('(');
    const rp = stat.lastIndexOf(')');
    if (lp < 0 || rp < 0 || rp < lp) break;
    const comm = stat.slice(lp + 1, rp);
    const rest = stat.slice(rp + 2).split(' ');
    const ppid = Number(rest[1]);
    out.parent_chain.push({ pid: cursor, comm });

    // Identify trigger source on the way up — first match wins.
    if (!out.trigger_source) {
      for (const t of TRIGGER_NAMES) {
        if (t.match.test(comm)) { out.trigger_source = t.source; break; }
      }
    }

    if (!Number.isFinite(ppid) || ppid <= 1 || seen.has(ppid)) {
      if (ppid === 1 && !out.trigger_source) out.trigger_source = 'systemd';
      break;
    }
    seen.add(ppid);
    cursor = ppid;
  }

  // start_time: the kernel records start_time in clock ticks since boot in
  // /proc/<pid>/stat field 22. We could compute the wall-clock start, but for
  // governance the connection timestamp is what matters; skip for v1.

  return out;
}

async function readFileSafe(p) {
  try { return await fs.readFile(p, 'utf8'); } catch { return null; }
}

// Tiny /etc/passwd cache. The file is small and rarely changes, so we read it
// on demand and cache for the daemon's lifetime. SIGHUP to reset if needed.
let passwdCache = null;
async function loadPasswd() {
  if (passwdCache) return passwdCache;
  const map = new Map();
  try {
    const text = await fs.readFile('/etc/passwd', 'utf8');
    for (const line of text.split('\n')) {
      const cols = line.split(':');
      if (cols.length >= 3) {
        const name = cols[0];
        const uid = Number(cols[2]);
        if (Number.isFinite(uid)) map.set(uid, name);
      }
    }
  } catch {}
  passwdCache = map;
  return map;
}

async function uidToName(uid) {
  const m = await loadPasswd();
  return m.get(uid) || null;
}

export function resetPasswdCache() { passwdCache = null; }
