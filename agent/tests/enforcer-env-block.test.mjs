// THE ENFORCER'S Add-Type MUST NOT INHERIT THE CFAI_* PAYLOADS.
//
// enforcer.js spawns enforcer-win.ps1 with ~60 KB of CFAI_* JSON in its
// environment (CFAI_MODEL_ROUTER_CONFIG ~34K chars, CFAI_WEB_SURFACES ~10K,
// CFAI_BLOCK_PATTERNS growing with policy, ...). The .ps1 then calls Add-Type,
// which launches csc.exe with this process's WHOLE environment block, and .NET
// refuses to start a child whose block is over 65,535 bytes. On 2026-10-09 a
// policy push of 38 block rules took a real machine to 66,180 bytes: every
// respawn failed with "The environment block used to start a process cannot be
// longer than 65535 bytes" and the helper crash-looped every ~4s. No blocking,
// no routing, no Tokenize & Send, on every machine that received that policy.
//
// The fix: enforcer-win.ps1 copies every $env:CFAI_* value into a script
// variable, then removes the CFAI_* vars from the process environment before
// Add-Type. The only ones kept are those the C# reads at runtime through
// Environment.GetEnvironmentVariable. This file pins that, and also budgets the
// payload prompt-watcher.ps1 (which does the same Add-Type with NO clear) gets.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { EventEmitter } from 'node:events';
import { createRequire, syncBuiltinESMExports } from 'node:module';

// os.homedir() reads USERPROFILE on Windows and HOME elsewhere. Point both at
// an empty temp dir BEFORE any agent module loads: Enforcer.start() writes its
// heartbeat and pid files under ~/.cloudfuze-aigov, and those must never land
// in a real agent's state dir (a live helper's deadman reads them). Each
// node --test file is its own process, so nothing else is affected.
const EMPTY_HOME = mkdtempSync(join(tmpdir(), 'cfai-env-block-'));
process.env.USERPROFILE = EMPTY_HOME;
process.env.HOME = EMPTY_HOME;

// Capture spawn() instead of running PowerShell. enforcer.js/prompt-watcher.js
// bind `spawn` through an ESM named import of a builtin, which
// syncBuiltinESMExports() re-points at the stub.
const require = createRequire(import.meta.url);
const cp = require('node:child_process');
const spawned = [];
cp.spawn = (cmd, args, opts) => {
  spawned.push({ cmd, args, env: opts?.env || {} });
  const child = new EventEmitter();
  child.pid = 0;
  child.stdin = { writable: true, write: () => true, end() {}, on() {} };
  child.stdout = Object.assign(new EventEmitter(), { setEncoding() {} });
  child.stderr = Object.assign(new EventEmitter(), { setEncoding() {} });
  child.kill = () => {};
  return child;
};
syncBuiltinESMExports();
Object.defineProperty(process, 'platform', { value: 'win32' });

const HERE = dirname(fileURLToPath(import.meta.url));
const OS = join(HERE, '..', 'src', 'os_monitor');
const mod = (f) => import(pathToFileURL(join(OS, f)).href);
const { Enforcer } = await mod('enforcer.js');
const { PromptWatcher } = await mod('prompt-watcher.js');
const { watcherProcessNames } = await mod('ai-processes.js');
const { getBlockPatterns } = await mod('classifier.js');

const PS1 = readFileSync(join(OS, 'enforcer-win.ps1'), 'utf8');
const ADD_TYPE = 'Add-Type -TypeDefinition $source';
const CLEAR_MARK = '$cfaiKeepForRuntime = @(';

// .NET's limit on a child's environment block, and what we let CFAI_* take of
// it. The rest belongs to the user's own environment, which we do not control
// (3.5–4 KB on the machines measured; roaming profiles can be far larger).
const DOTNET_ENV_BLOCK_MAX = 65_535;
const KEPT_CFAI_BUDGET = 4_096;
const PROMPT_WATCHER_CFAI_BUDGET = 24_000;

// Names in the .ps1's keep-list; [] when the clear block is missing, i.e. the
// pre-fix script, which removed nothing.
function keepList() {
  const m = PS1.match(/\$cfaiKeepForRuntime = @\(([^)]*)\)/);
  return m ? [...m[1].matchAll(/'([A-Z0-9_]+)'/g)].map((x) => x[1]) : null;
}

function cfaiChars(env, filter = () => true) {
  let n = 0;
  for (const [k, v] of Object.entries(env)) {
    if (k.startsWith('CFAI_') && filter(k)) n += k.length + 1 + String(v).length + 1;
  }
  return n;
}

function captureEnforcerEnv(blockPatterns) {
  spawned.length = 0;
  const e = new Enforcer({ log: null, aiProcessNames: watcherProcessNames(), blockPatterns });
  e.start();
  e.stop();
  const call = spawned.find((s) => s.args.some((a) => String(a).endsWith('enforcer-win.ps1')));
  assert.ok(call, 'Enforcer.start() did not spawn enforcer-win.ps1');
  return call.env;
}

test('enforcer-win.ps1 clears CFAI_* from its environment before Add-Type', () => {
  const clearAt = PS1.indexOf(CLEAR_MARK);
  const addTypeAt = PS1.indexOf(ADD_TYPE);
  assert.ok(addTypeAt > 0, `expected "${ADD_TYPE}" in enforcer-win.ps1`);
  assert.equal((PS1.match(/^\s*Add-Type /gm) || []).length, 1,'enforcer-win.ps1 must have exactly one Add-Type, after the clear');
  assert.ok(clearAt > 0,
    'enforcer-win.ps1 no longer removes CFAI_* from the process environment before Add-Type. csc.exe inherits the '
    + 'whole block, and the CFAI_* payloads alone (~60 KB) push it past .NET\'s 65,535-byte limit: the helper '
    + 'crash-loops on every machine with a real policy.');
  assert.ok(clearAt < addTypeAt, 'the CFAI_* clear must run BEFORE Add-Type');
  assert.match(PS1.slice(clearAt, addTypeAt),
    /Get-ChildItem -Path Env: \| Where-Object \{ \$_\.Name -like 'CFAI_\*' \}[\s\S]*\[Environment\]::SetEnvironmentVariable\(\$cfaiVar\.Name, \$null, 'Process'\)/);
});

test('no $env:CFAI_ read comes after the clear (it would silently see nothing)', () => {
  const clearAt = PS1.indexOf(CLEAR_MARK);
  assert.ok(clearAt > 0);
  const late = [...PS1.slice(clearAt).matchAll(/\$env:(CFAI_[A-Z0-9_]+)/gi)].map((m) => m[1]);
  assert.deepEqual(late, [], `read after the clear: ${late.join(', ')}`);
  // ...and every one read before it is captured into a script variable.
  assert.ok([...PS1.slice(0, clearAt).matchAll(/\$env:CFAI_/g)].length >= 10);
});

test('the keep-list is exactly what the C# reads via Environment.GetEnvironmentVariable', () => {
  const keep = keepList();
  assert.ok(keep, 'keep-list ($cfaiKeepForRuntime) not found');
  const csharp = [...new Set([...PS1.matchAll(/Environment\.GetEnvironmentVariable\("(CFAI_[A-Z0-9_]+)"\)/g)].map((m) => m[1]))];
  assert.deepEqual([...keep].sort(), csharp.sort(),
    'a CFAI_* var the C# reads at runtime must be kept (or it reads null), and nothing else may be — every kept '
    + 'var is inherited by csc.exe');
});

test('env csc.exe inherits from the enforcer stays far below 65,535 even with a huge block-pattern payload', (t) => {
  const keep = new Set(keepList() || []);
  const cleared = keepList() !== null;
  const realistic = captureEnforcerEnv(getBlockPatterns());
  // 400 rules x ~250 chars: far past any real policy. With the clear in place
  // its size must not matter at all.
  const huge = Array.from({ length: 400 }, (_, i) => ({
    name: `custom-rule-${i}`, source: `(?:secret|token)[-_ ]?${'[A-Za-z0-9]{8}'.repeat(18)}${i}`,
    ignoreCase: true, severity: 'high', label: null,
  }));
  const hugeEnv = captureEnforcerEnv(huge);
  for (const [label, env] of [['realistic', realistic], ['huge', hugeEnv]]) {
    const total = cfaiChars(env);
    const inherited = cfaiChars(env, (k) => !cleared || keep.has(k));
    t.diagnostic(`${label}: CFAI_* handed to powershell ${total} chars; left in env at Add-Type ${inherited} chars`);
    assert.ok(inherited < KEPT_CFAI_BUDGET,
      `${label}: ${inherited} chars of CFAI_* would reach csc.exe (budget ${KEPT_CFAI_BUDGET}, .NET limit `
      + `${DOTNET_ENV_BLOCK_MAX} for the WHOLE block incl. the user's own env)`);
  }
  // Sanity: the huge case is past the limit on its own, so the budget check
  // above passes only because of the clear.
  assert.ok(cfaiChars(hugeEnv) > DOTNET_ENV_BLOCK_MAX);
});

test('prompt-watcher.ps1 (Add-Type with no clear) gets a CFAI_* payload well inside the limit', (t) => {
  spawned.length = 0;
  const w = new PromptWatcher({ log: null, aiProcessNames: watcherProcessNames(), trackerMode: true, webSurfaces: true });
  w.start();
  try { w.stop?.(); } catch {}
  const call = spawned.find((s) => s.args.some((a) => String(a).endsWith('prompt-watcher.ps1')));
  assert.ok(call, 'PromptWatcher.start() did not spawn prompt-watcher.ps1');
  const n = cfaiChars(call.env);
  t.diagnostic(`prompt-watcher CFAI_* payload ${n} chars; budget ${PROMPT_WATCHER_CFAI_BUDGET}`);
  assert.ok(n < PROMPT_WATCHER_CFAI_BUDGET,
    `prompt-watcher.ps1 is spawned with ${n} chars of CFAI_* and runs Add-Type without clearing them. Before `
    + `raising this budget, give prompt-watcher.ps1 the same capture-then-clear enforcer-win.ps1 has.`);
});
