// Smoke test for the proxy watchdog. Only touches ProxyOverride so it cannot
// affect the user's actual browsing. Restores in a finally block.

import { spawn } from 'node:child_process';
import { writeFile, readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const REG = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';

function pwsh(script) {
  return new Promise((resolve, reject) => {
    const c = spawn('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], {
      stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    });
    let out = '', err = '';
    c.stdout.on('data', d => out += d);
    c.stderr.on('data', d => err += d);
    c.on('exit', code => code === 0 ? resolve(out) : reject(new Error(err || 'pwsh exit ' + code)));
  });
}

async function snapshot() {
  const script =
    `$p = Get-ItemProperty -Path '${REG}' -ErrorAction SilentlyContinue; ` +
    `[PSCustomObject]@{ ` +
    `  ProxyEnable   = [int]($p.ProxyEnable);  ` +
    `  ProxyServer   = [string]($p.ProxyServer); ` +
    `  ProxyOverride = [string]($p.ProxyOverride); ` +
    `  AutoConfigURL = [string]($p.AutoConfigURL); ` +
    `} | ConvertTo-Json -Compress`;
  const out = (await pwsh(script)).trim();
  return JSON.parse(out);
}

async function setOverride(v) {
  const esc = v.replace(/'/g, "''");
  await pwsh(`New-ItemProperty -Path '${REG}' -Name 'ProxyOverride' -PropertyType String -Value '${esc}' -Force | Out-Null`);
}

async function getOverride() {
  const out = (await pwsh(`(Get-ItemProperty -Path '${REG}').ProxyOverride`)).trim();
  return out;
}

const TEST_MARKER  = '__cfai_watchdog_test_restore__';
const TEST_MUTATED = '__cfai_watchdog_test_mutated__';

const snap = await snapshot();
console.log('snapshot:', snap);
const realOverride = snap.ProxyOverride ?? '';

try {
  const stateDir  = path.join(os.homedir(), '.cloudfuze-aigov');
  const statePath = path.join(stateDir, 'proxy-state.json');
  await mkdir(stateDir, { recursive: true });
  await writeFile(statePath, JSON.stringify({
    savedAt: new Date().toISOString(),
    activatedBy: process.pid,
    mode: 'pac',
    original: {
      ProxyEnable:  snap.ProxyEnable  ?? 0,
      ProxyServer:  snap.ProxyServer  ?? '',
      ProxyOverride: TEST_MARKER,
      AutoConfigURL: snap.AutoConfigURL ?? '',
    },
  }), 'utf8');

  await setOverride(TEST_MUTATED);
  console.log('after mutation:', await getOverride());

  const wd = path.resolve('./src/proxy/watchdog.js');
  const child = spawn(process.execPath, [wd, '999999', statePath], { stdio: ['ignore', 'pipe', 'pipe'] });
  let err = '';
  child.stderr.on('data', c => err += c);
  const code = await new Promise(res => child.on('exit', res));
  console.log('watchdog exit:', code);
  if (err) console.log('watchdog stderr:', err);

  const after = await getOverride();
  console.log('after watchdog restore:', after);

  let stateGone = false;
  try { await readFile(statePath, 'utf8'); } catch { stateGone = true; }
  console.log('state file removed:', stateGone);

  const ok = after === TEST_MARKER && stateGone && code === 0;
  console.log(ok ? 'WATCHDOG E2E OK' : 'WATCHDOG E2E FAIL');
  process.exitCode = ok ? 0 : 1;
} finally {
  await setOverride(realOverride);
  console.log('cleanup: ProxyOverride restored to', JSON.stringify(realOverride));
}
