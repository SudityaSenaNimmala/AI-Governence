// Windows attribution.
//
// Same surface as the Linux module: given a PID, return user / cmdline /
// exe / cwd / parent chain / trigger source. Implementation uses a single
// PowerShell CIM query to fetch everything in one shot — much faster than
// one `wmic` per process.
//
// Notes vs Linux:
//   - No `loginuid` equivalent. We capture the Windows user (DOMAIN\User)
//     via Win32_Process.GetOwner(), which IS the elevated user — UAC
//     elevation does NOT change the username string, only the process token
//     integrity level. So attribution is correct for normal use; the only
//     gap is "originally non-admin user who ran as admin" — Windows logs
//     this in Security event log (EventID 4648) if a client needs full audit.
//   - `cwd` is read from the PEB via WMI which is unreliable on hardened
//     systems — we ship null when it's not available rather than spawning
//     a separate native call.
//   - Trigger source maps Windows-specific parents: svchost.exe = service,
//     taskhostw.exe = scheduled task, explorer.exe = interactive desktop,
//     sshd.exe = OpenSSH, conhost.exe + powershell.exe/cmd.exe = interactive
//     shell.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

const TRIGGER_NAMES = [
  { match: /^svchost\.exe$/i,                                  source: 'service' },
  { match: /^services\.exe$/i,                                 source: 'service' },
  { match: /^taskhostw?\.exe$/i,                               source: 'scheduled_task' },
  { match: /^taskeng\.exe$/i,                                  source: 'scheduled_task' },
  { match: /^sshd\.exe$/i,                                     source: 'ssh' },
  { match: /^WinSshd\.exe$/i,                                  source: 'ssh' },
  { match: /^explorer\.exe$/i,                                 source: 'interactive_desktop' },
  { match: /^powershell\.exe$|^pwsh\.exe$/i,                   source: 'interactive_shell' },
  { match: /^cmd\.exe$/i,                                      source: 'interactive_shell' },
  { match: /^Windows ?Terminal\.exe$|^conhost\.exe$/i,         source: 'interactive_terminal' },
  { match: /gitlab-runner|github-runner|jenkins|buildkite/i,   source: 'ci' },
  { match: /^docker\.exe$|^dockerd\.exe$|^containerd\.exe$/i,  source: 'container' },
];

// Single PowerShell query that:
//   1. Fetches ALL processes in one Get-CimInstance call (fast — one WMI hit
//      instead of N round-trips for a per-PID lookup loop).
//   2. Walks the parent chain in-memory using a PID → process hashtable.
//   3. Calls GetOwner only for the chain we actually keep (max 8 procs).
//   4. Returns a JSON array, target-process first.
//
// Note: powershell.exe with `-Command` does NOT bind positional argv to $args
// the way `-File` does. The simplest robust pattern is to inline the PID into
// the script (PID is a validated integer, so no injection risk).
function buildPsScript(pidInt) {
  return `
$ErrorActionPreference = 'SilentlyContinue'
$all = Get-CimInstance Win32_Process
$byPid = @{}
foreach ($p in $all) { $byPid[[int]$p.ProcessId] = $p }
$out = @()
$cursor = ${pidInt}
$seen = @{}
$firstUser = $null
for ($i = 0; $i -lt 8; $i++) {
  if ($seen.ContainsKey($cursor)) { break }
  $seen[$cursor] = $true
  $p = $byPid[$cursor]
  if (-not $p) { break }
  # GetOwner is expensive (one WMI roundtrip per call). Only resolve it for
  # the target process — parent-chain entries only need pid+ppid+name.
  $user = $null
  if ($i -eq 0) {
    $ownerInfo = Invoke-CimMethod -InputObject $p -MethodName GetOwner
    if ($ownerInfo -and $ownerInfo.User) {
      if ($ownerInfo.Domain) { $user = ($ownerInfo.Domain + '\\' + $ownerInfo.User) } else { $user = $ownerInfo.User }
    }
    $firstUser = $user
  }
  $out += [pscustomobject]@{
    pid     = [int]$p.ProcessId
    ppid    = [int]$p.ParentProcessId
    name    = $p.Name
    exe     = $p.ExecutablePath
    cmdline = $p.CommandLine
    user    = $user
    cwd     = $null
  }
  if ($p.ParentProcessId -le 4) { break }
  $cursor = [int]$p.ParentProcessId
}
if ($out.Count -eq 0) { '[]' }
elseif ($out.Count -eq 1) { '[' + ($out[0] | ConvertTo-Json -Depth 3 -Compress) + ']' }
else { $out | ConvertTo-Json -Depth 3 -Compress }
`;
}

export async function attribute(pid) {
  if (!Number.isFinite(pid) || pid <= 0) return null;
  const chain = await runPs(pid);
  if (!chain || chain.length === 0) return null;

  const self = chain[0];
  const out = {
    pid:      self.pid,
    uid:      null,                // Windows doesn't use numeric uids
    loginuid: null,                // no Linux-equivalent on Windows
    user:     self.user || null,
    cmdline:  self.cmdline || null,
    exe:      self.exe || null,
    cwd:      self.cwd || null,
    parent_chain: chain.map((c) => ({ pid: c.pid, comm: c.name })),
    trigger_source: null,
    started_at: null,
  };

  // First parent (or self) whose name matches a known trigger wins.
  for (const c of chain) {
    if (!c.name) continue;
    for (const t of TRIGGER_NAMES) {
      if (t.match.test(c.name)) { out.trigger_source = t.source; break; }
    }
    if (out.trigger_source) break;
  }

  return out;
}

async function runPs(pid) {
  try {
    const script = buildPsScript(Math.trunc(pid));
    const { stdout } = await exec('powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { timeout: 15000, maxBuffer: 4 * 1024 * 1024 }
    );
    const text = stdout.trim();
    if (!text) return [];
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return null;
  }
}
