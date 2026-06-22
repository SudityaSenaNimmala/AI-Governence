// GPU activity watcher — Tier 3 L5 signal layer.
//
// Polls a per-platform GPU process listing every WATCH_INTERVAL_MS and emits
// a `gpu_activity` signal for any PID newly seen. Re-emits a heartbeat every
// HEARTBEAT_MS for long-running processes so the dashboard can show "still
// running".
//
// Backends, tried in order:
//   1. nvidia-smi (Linux, Windows, macOS+eGPU)  — full per-PID memory data
//   2. rocm-smi   (Linux + AMD)                 — per-PID GPU usage
//   3. powermetrics (macOS Apple Silicon)       — global GPU power only; we
//                                                 synthesize a per-PID signal
//                                                 by correlating with the
//                                                 top GPU-using process.
//   4. PerfCounters (Windows)                   — per-PID GPU Engine % via
//                                                 Get-Counter; no memory data.
//
// What this catches that the proxy doesn't:
//   - A Python script that loaded a .gguf in-process and is running inference
//     locally → no HTTPS traffic, but very visible on the GPU.
//   - A C++ binary using libllama or vLLM's core directly.
//
// Limitation: signal only. We see *that* inference is happening and *who*
// (via /proc attribution), but not the prompts. Python content is covered by
// the import-hook shim; native inference content needs Tier 3 LD_PRELOAD.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import process from 'node:process';
import { attribute } from './attribution.js';

const exec = promisify(execFile);

const WATCH_INTERVAL_MS = 5_000;    // 5s — fast enough to see short jobs, low overhead
const HEARTBEAT_MS      = 60_000;   // re-emit for long-running processes every 60s

export function startGpuWatch({ reporter, log }) {
  let stopped = false;
  let backend = null;                // resolved on first run: 'nvidia' | 'rocm' | 'powermetrics' | 'win-perf' | null
  let lastSeen = new Map();          // pid → { firstAt, lastEmitAt, details }

  async function chooseBackend() {
    // Order matters: nvidia first (most info), rocm next (Linux+AMD), then
    // platform-specific fallbacks.
    if (await haveCmd('nvidia-smi'))                       return 'nvidia';
    if (process.platform === 'linux'  && await haveCmd('rocm-smi'))     return 'rocm';
    if (process.platform === 'darwin' && await haveCmd('powermetrics')) return 'powermetrics';
    if (process.platform === 'win32')                                    return 'win-perf';
    return null;
  }

  async function tick() {
    if (stopped) return;
    try {
      if (backend === null) {
        backend = await chooseBackend();
        if (backend === null) {
          log?.info?.('gpu-watch: no GPU monitoring tool found (nvidia-smi / rocm-smi / powermetrics) — GPU signals disabled');
          stopped = true;     // give up; no point polling further
          return;
        }
        log?.info?.(`gpu-watch: using backend "${backend}"`);
      }
      const procs = await listGpuProcs(backend);
      const now = Date.now();
      const seenThisTick = new Set();
      for (const p of procs) {
        seenThisTick.add(p.pid);
        const prev = lastSeen.get(p.pid);
        const shouldEmit = !prev || (now - prev.lastEmitAt > HEARTBEAT_MS);
        if (shouldEmit) {
          const attr = await attribute(p.pid).catch(() => null);
          reporter.enqueue({
            occurred_at: new Date(now).toISOString(),
            kind: 'gpu_activity',
            attribution: attr,
            details: {
              backend,
              gpu_name: p.gpu_name || null,
              used_memory_mb: p.used_memory_mb ?? null,
              utilization_pct: p.utilization_pct ?? null,
              process_name: p.process_name || null,
            },
          });
          lastSeen.set(p.pid, { firstAt: prev?.firstAt || now, lastEmitAt: now });
        }
      }
      // Forget processes that haven't been seen for two ticks.
      for (const pid of Array.from(lastSeen.keys())) {
        if (!seenThisTick.has(pid) && now - lastSeen.get(pid).lastEmitAt > WATCH_INTERVAL_MS * 2) {
          lastSeen.delete(pid);
        }
      }
    } catch (err) {
      log?.warn?.(`gpu-watch: tick error ${err?.message || err}`);
    }
  }

  // Use an unrefed setInterval so the watcher doesn't keep the process alive
  // on its own (the main proxy server is what holds the loop).
  const timer = setInterval(tick, WATCH_INTERVAL_MS);
  if (typeof timer.unref === 'function') timer.unref();
  // Fire once immediately so we don't wait 5s on boot.
  tick();

  return {
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}

async function listGpuProcs(backend) {
  try {
    if (backend === 'nvidia')        return await listNvidia();
    if (backend === 'rocm')          return await listRocm();
    if (backend === 'powermetrics')  return await listPowermetrics();
    if (backend === 'win-perf')      return await listWinPerf();
  } catch (err) {
    if (err?.code === 'ENOENT') return [];
    return [];
  }
  return [];
}

async function listNvidia() {
  const { stdout } = await exec('nvidia-smi', [
    '--query-compute-apps=pid,process_name,used_memory,gpu_name',
    '--format=csv,noheader,nounits',
  ], { timeout: 4_000 });
  const out = [];
  for (const line of stdout.split('\n')) {
    const cleaned = line.trim();
    if (!cleaned) continue;
    const parts = cleaned.split(',').map((s) => s.trim());
    if (parts.length < 4) continue;
    const pid = Number(parts[0]);
    if (!Number.isFinite(pid) || pid <= 0) continue;
    out.push({
      pid,
      process_name: parts[1],
      used_memory_mb: Number(parts[2]) || 0,
      gpu_name: parts[3],
    });
  }
  return out;
}

async function listRocm() {
  // rocm-smi --showpidgpus --json returns:
  //   { "PID 1234": { "GPU0": ... }, "PID 5678": {...} }
  // and --showmeminfo vram per-PID is a separate call. We do both, merge.
  const { stdout: pidsOut } = await exec('rocm-smi', ['--showpidgpus', '--json'], { timeout: 4_000 });
  let pids = {};
  try { pids = JSON.parse(pidsOut); } catch { return []; }
  let memData = {};
  try {
    const { stdout: memOut } = await exec('rocm-smi', ['--showmempidgpus', '--json'], { timeout: 4_000 });
    memData = JSON.parse(memOut);
  } catch { /* mem data is optional */ }

  const out = [];
  for (const [key, value] of Object.entries(pids)) {
    const m = key.match(/^PID\s+(\d+)$/i);
    if (!m) continue;
    const pid = Number(m[1]);
    const gpuKeys = Object.keys(value || {}).filter((k) => /^GPU\d+/i.test(k));
    const gpuName = gpuKeys[0] || 'AMD GPU';
    // VRAM key shape: memData['PID 1234'].VRAM = "256 MiB"
    let usedMb = null;
    const mem = memData?.[key]?.VRAM;
    if (typeof mem === 'string') {
      const mn = mem.match(/^([\d.]+)\s*MiB/i);
      if (mn) usedMb = Number(mn[1]);
    }
    out.push({
      pid,
      process_name: null,
      used_memory_mb: usedMb,
      gpu_name: gpuName,
    });
  }
  return out;
}

async function listPowermetrics() {
  // powermetrics gives global GPU state, NOT per-PID, on Apple Silicon. The
  // closest we get is "GPU active residency" + the top GPU-using process from
  // `top -stats pid,command,gputime -l 1 -n 5`. If GPU residency is non-zero
  // AND there's a process with gputime > 0 in that window, we emit one
  // signal for the top process.
  //
  // Requires sudo for powermetrics. The daemon runs as root, so OK.
  const { stdout } = await exec('powermetrics', [
    '--samplers', 'gpu_power',
    '-i', '1000', '-n', '1',
    '--show-process-gpu',
  ], { timeout: 6_000 });

  // Try to parse the "GPU per-process" block — newer powermetrics versions
  // include it when --show-process-gpu is set:
  //   Name                                PID    GPU-cycle-share
  //   python3                            1234    63.21%
  const out = [];
  const lines = stdout.split('\n');
  let inProcBlock = false;
  for (const line of lines) {
    if (/GPU per-process/i.test(line) || /\bPID\b.*\bGPU/.test(line)) {
      inProcBlock = true; continue;
    }
    if (inProcBlock) {
      const m = line.trim().match(/^(\S+)\s+(\d+)\s+([\d.]+)\s*%/);
      if (m) {
        const pct = Number(m[3]);
        if (pct > 0) out.push({
          pid: Number(m[2]),
          process_name: m[1],
          used_memory_mb: null,
          gpu_name: 'Apple GPU',
          utilization_pct: pct,
        });
      } else if (line.trim() === '') {
        inProcBlock = false;
      }
    }
  }
  return out;
}

async function listWinPerf() {
  // Windows: no nvidia-smi means integrated/AMD. Use Get-Counter to find
  // per-process GPU Engine utilization > 0%. The counter `\GPU Engine(*)
  // \Utilization Percentage` has instances of the form `pid_NNNN_<luid>_phys
  // _<n>_eng_<n>_engtype_<type>`. We extract the PID and sum across engines.
  // String.raw keeps backslashes literal so the counter path and regex
  // survive both JS-string parsing and the eventual hand-off to PowerShell.
  const script = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
$samples = (Get-Counter '\GPU Engine(*)\Utilization Percentage' -ErrorAction SilentlyContinue).CounterSamples
if (-not $samples) { '[]'; return }
$byProc = @{}
foreach ($s in $samples) {
  if ($s.CookedValue -le 0) { continue }
  $pidMatch = [regex]::Match($s.InstanceName, 'pid_(\d+)_')
  if (-not $pidMatch.Success) { continue }
  $procId = [int]$pidMatch.Groups[1].Value
  if ($byProc.ContainsKey($procId)) { $byProc[$procId] += $s.CookedValue } else { $byProc[$procId] = $s.CookedValue }
}
$rows = $byProc.GetEnumerator() | ForEach-Object {
  [pscustomobject]@{ pid = [int]$_.Key; utilization_pct = [double]$_.Value }
}
if ($rows.Count -eq 0) { '[]' }
elseif ($rows.Count -eq 1) { '[' + ($rows[0] | ConvertTo-Json -Compress) + ']' }
else { $rows | ConvertTo-Json -Compress }
`;
  // 15s timeout because cold powershell.exe + iterating Get-Counter samples
  // can take 4-8s. Bigger than the watch interval but the tick is throttled
  // by the interval timer regardless — overlapping ticks won't happen.
  const { stdout } = await exec('powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', script],
    { timeout: 15_000 }
  );
  const text = stdout.trim();
  if (!text || text === '[]') return [];
  let parsed;
  try { parsed = JSON.parse(text); } catch { return []; }
  const arr = Array.isArray(parsed) ? parsed : [parsed];
  return arr.map((r) => ({
    pid: r.pid,
    process_name: null,
    used_memory_mb: null,
    gpu_name: 'Windows GPU',
    utilization_pct: r.utilization_pct,
  }));
}

async function haveCmd(cmd) {
  try {
    if (process.platform === 'win32') {
      // `where.exe` returns 0 if found
      await exec('where.exe', [cmd], { timeout: 1_500 });
    } else {
      await exec('which', [cmd], { timeout: 1_500 });
    }
    return true;
  } catch { return false; }
}
