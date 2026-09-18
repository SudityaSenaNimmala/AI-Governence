// macOS attribution.
//
// macOS does not expose /proc, so we use the BSD `ps` command + `lsof` for
// process metadata. Same surface as the Linux module — given a PID, return
// user / cmdline / exe / cwd / parent chain / trigger source.
//
// Why shellouts instead of libproc bindings: shipping cross-arch (Intel +
// Apple Silicon) native modules complicates the installer. `ps` is universal
// and the daemon's call rate is far below where shellout overhead matters
// (hundreds of calls/min, not thousands).
//
// macOS has no clean equivalent of Linux `loginuid` — UAC equivalents
// (sudo elevation via auth services) don't preserve the original logged-in
// user reliably. We attribute to the process owner (`uid`) and capture the
// terminal/session via parent-chain walk, which is good enough for governance.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

// Map parent process names → trigger source. macOS-specific names.
const TRIGGER_NAMES = [
  { match: /^launchd$/,              source: 'launchd' },         // LaunchDaemon / LaunchAgent
  { match: /^cron$/,                 source: 'cron' },
  { match: /^sshd$/,                 source: 'ssh' },
  { match: /^login$/,                source: 'login' },
  { match: /^bash$|^zsh$|^sh$|^fish$/, source: 'interactive_shell' },
  { match: /^Terminal$|^iTerm2?$|^WezTerm$|^Alacritty$|^kitty$/, source: 'interactive_terminal' },
  { match: /gitlab-runner|github-runner|jenkins|buildkite/, source: 'ci' },
  { match: /^docker(d)?$|^containerd$|^com\.docker/, source: 'container' },
];

export async function attribute(pid) {
  if (!Number.isFinite(pid) || pid <= 0) return null;
  const out = {
    pid,
    uid: null,
    loginuid: null,            // not available on macOS
    user: null,
    cmdline: null,
    exe: null,
    cwd: null,
    parent_chain: [],
    trigger_source: null,
    started_at: null,
  };

  // One ps call per process for the basics. `-o` selects columns; `args=`
  // (with the equals sign) suppresses the header so the value is the rest of
  // the line — preserves spaces in the command line. We do basics + args in
  // two calls to keep parsing simple.
  const basics = await psOne(pid, ['uid', 'user', 'ppid', 'comm']);
  if (!basics) return out;
  out.uid  = basics.uid != null ? Number(basics.uid) : null;
  out.user = basics.user || null;
  out.exe  = basics.comm || null;

  // Full command line via `ps -p PID -o args=`.
  try {
    const { stdout } = await exec('ps', ['-p', String(pid), '-o', 'args='], { timeout: 1000 });
    out.cmdline = stdout.trim() || null;
  } catch {}

  // cwd via lsof. The cwd row has fd column = 'cwd'.
  try {
    const { stdout } = await exec('lsof', ['-a', '-d', 'cwd', '-Fn', '-p', String(pid)], { timeout: 1000 });
    // lsof -F output: lines start with field codes. `n` line is the name (cwd path).
    const m = stdout.split('\n').find((l) => l.startsWith('n'));
    if (m) out.cwd = m.slice(1);
  } catch {}

  // Parent chain — repeat ps calls following ppid until we hit 0/1 or 8 levels.
  let cursorPid = pid;
  let cursorComm = basics.comm || null;
  let cursorPpid = basics.ppid != null ? Number(basics.ppid) : null;
  const seen = new Set([pid]);
  for (let i = 0; i < 8; i++) {
    out.parent_chain.push({ pid: cursorPid, comm: cursorComm });
    if (!out.trigger_source && cursorComm) {
      for (const t of TRIGGER_NAMES) {
        if (t.match.test(cursorComm)) { out.trigger_source = t.source; break; }
      }
    }
    if (!cursorPpid || cursorPpid <= 1 || seen.has(cursorPpid)) {
      if (cursorPpid === 1 && !out.trigger_source) out.trigger_source = 'launchd';
      break;
    }
    seen.add(cursorPpid);
    const next = await psOne(cursorPpid, ['ppid', 'comm']);
    if (!next) break;
    cursorPid = cursorPpid;
    cursorComm = next.comm;
    cursorPpid = next.ppid != null ? Number(next.ppid) : null;
  }

  return out;
}

// Run `ps -p PID -o col1,col2,...=` and parse the single output line.
// Using `=` after the last column suppresses the header. Whitespace-separated
// values, with the last column getting any trailing spaces (safe because we
// only ever ask for simple identifiers, not the args column).
async function psOne(pid, cols) {
  try {
    const fmt = cols.join(',');
    const { stdout } = await exec('ps', ['-p', String(pid), '-o', `${fmt}=`], { timeout: 1000 });
    const line = stdout.split('\n').find((l) => l.trim().length > 0);
    if (!line) return null;
    const parts = line.trim().split(/\s+/);
    const rec = {};
    for (let i = 0; i < cols.length && i < parts.length; i++) {
      rec[cols[i]] = parts[i];
    }
    return rec;
  } catch { return null; }
}
