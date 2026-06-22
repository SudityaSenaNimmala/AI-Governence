// Install / uninstall the CloudFuze AI Governance Root CA into the
// per-USER Windows trust store (`Cert:\CurrentUser\Root`).
//
// We use the per-user store, not LocalMachine, so no admin elevation is
// required. Downside: browsers that have their own cert store (Firefox does;
// Chrome / Edge / Electron all use the OS store) won't pick this up. For v1
// that's fine — Claude Desktop, Cursor, ChatGPT, Edge, Chrome all use the OS
// store; Firefox is out of scope and we'll handle separately if it becomes a
// priority.
//
// For enterprise rollout the install path changes to LocalMachine via Intune
// Trusted Root Certification Authorities policy — same cert, different store.

import { spawn } from 'node:child_process';
import { writeFile, unlink, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import os from 'node:os';

const STORE = 'Root';                            // CurrentUser\Root
const SUBJECT_CN = 'CloudFuze AI Governance Root CA';

/**
 * Install the CA into the user's Trusted Root store. Idempotent — if a cert
 * with the same fingerprint is already present, returns { installed: false,
 * already: true }. If a DIFFERENT cert with the same CN exists (stale
 * previous CA), we uninstall it first and install the fresh one.
 */
export async function installCA({ caCertPem, fingerprintSha256, log }) {
  if (process.platform !== 'win32') {
    return { installed: false, reason: 'not-win32' };
  }
  // Is a CloudFuze CA already present?
  const present = await findCertBySubject(SUBJECT_CN);
  if (present.length > 0) {
    const match = present.find((p) => p.thumbprint.toLowerCase() === fingerprintSha256.toLowerCase().replace(/:/g, ''));
    if (match) {
      log?.info?.(`proxy/trust: CA already trusted (thumbprint ${match.thumbprint.slice(0, 16)}…)`);
      return { installed: false, already: true, thumbprint: match.thumbprint };
    }
    // Stale CA — different fingerprint, same CN. Remove it before installing
    // the new one so the trust store doesn't accumulate orphan CAs.
    for (const stale of present) {
      log?.warn?.(`proxy/trust: removing stale CloudFuze CA thumbprint=${stale.thumbprint.slice(0, 16)}…`);
      await removeCertByThumbprint(stale.thumbprint);
    }
  }
  // Write the PEM to a temp file and add it via certutil.
  const tmp = await mkdtemp(join(os.tmpdir(), 'cfai-ca-'));
  const tmpFile = join(tmp, 'cloudfuze-root-ca.crt');
  await writeFile(tmpFile, caCertPem, 'utf8');
  try {
    await runCertutil(['-user', '-addstore', STORE, tmpFile]);
    log?.info?.(`proxy/trust: CA installed into CurrentUser\\Root`);
    return { installed: true, thumbprint: fingerprintSha256 };
  } finally {
    try { await unlink(tmpFile); } catch {}
  }
}

/** Remove all CloudFuze AI Governance CAs from the user's trust store. */
export async function uninstallCA({ log } = {}) {
  if (process.platform !== 'win32') return { removed: 0 };
  const present = await findCertBySubject(SUBJECT_CN);
  for (const p of present) {
    await removeCertByThumbprint(p.thumbprint);
    log?.info?.(`proxy/trust: removed CA thumbprint=${p.thumbprint.slice(0, 16)}…`);
  }
  return { removed: present.length };
}

// ---- internals ----

// PowerShell is friendlier than certutil for searching by subject — certutil
// has no clean search-and-list mode that returns thumbprints. Falls back to
// JSON-line output for easy parsing.
async function findCertBySubject(commonName) {
  const script = [
    `$certs = Get-ChildItem -Path Cert:\\CurrentUser\\${STORE} -ErrorAction SilentlyContinue |`,
    `  Where-Object { $_.Subject -like '*CN=${commonName}*' };`,
    `foreach ($c in $certs) {`,
    `  ConvertTo-Json -Compress -InputObject @{ thumbprint = $c.Thumbprint; subject = $c.Subject; notAfter = $c.NotAfter.ToString('o') };`,
    `}`,
  ].join(' ');
  const stdout = await runPwsh(script);
  return stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
}

async function removeCertByThumbprint(thumbprint) {
  // certutil expects the thumbprint without colons / spaces.
  const tp = thumbprint.replace(/[^0-9a-fA-F]/g, '');
  await runCertutil(['-user', '-delstore', STORE, tp]);
}

function runCertutil(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('certutil', args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', (c) => { stdout += String(c); });
    child.stderr.on('data', (c) => { stderr += String(c); });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`certutil ${args.join(' ')} exited ${code}: ${stderr || stdout}`));
    });
  });
}

function runPwsh(script) {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], {
      windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', (c) => { stdout += String(c); });
    child.stderr.on('data', (c) => { stderr += String(c); });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`powershell exit ${code}: ${stderr || stdout}`));
    });
  });
}
