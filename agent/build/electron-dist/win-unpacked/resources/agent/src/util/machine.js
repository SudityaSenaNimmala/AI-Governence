import os from 'node:os';
import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { loadCredentials } from './credentials.js';

// Derive a stable machine ID. Priority:
//   1. credentials.json — the ID this machine enrolled with. Always wins once
//      enrolled, so the ID never drifts after the first server handshake even
//      if hardware/NICs change or the OS gets reinstalled keeping the cred file.
//   2. OS-issued machine identifier (Windows MachineGuid, Linux /etc/machine-id,
//      macOS IOPlatformUUID). Stable across NIC changes, VPNs, dock connects.
//   3. Fallback: sha256(hostname + sorted MACs). Only used on a brand-new install
//      when neither (1) nor (2) is available.
export async function getMachineId() {
  const persisted = await readPersistedId();
  if (persisted) return persisted;

  const osId = await readOsMachineId();
  if (osId) return hash(`${os.hostname()}|os|${osId}`);

  return hashLegacyMacFingerprint();
}

async function readPersistedId() {
  try {
    const creds = await loadCredentials();
    return creds?.machineId || null;
  } catch {
    return null;
  }
}

async function readOsMachineId() {
  try {
    if (process.platform === 'win32') return readWindowsMachineGuid();
    if (process.platform === 'linux') return readLinuxMachineId();
    if (process.platform === 'darwin') return readDarwinPlatformUuid();
  } catch {
    // Best-effort — fall through to legacy fingerprint.
  }
  return null;
}

function readWindowsMachineGuid() {
  // reg.exe is on PATH on every supported Windows version. We read the
  // per-machine cryptography GUID — stable across reboots, NIC changes,
  // VPN toggles. Survives until the OS is reimaged.
  const res = spawnSync(
    'reg',
    ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'],
    { encoding: 'utf8', windowsHide: true }
  );
  if (res.status !== 0) return null;
  const m = res.stdout.match(/MachineGuid\s+REG_SZ\s+([0-9a-fA-F-]+)/);
  return m ? m[1].trim().toLowerCase() : null;
}

async function readLinuxMachineId() {
  // systemd machine-id; falls back to dbus copy on older systems.
  for (const path of ['/etc/machine-id', '/var/lib/dbus/machine-id']) {
    try {
      const buf = await readFile(path, 'utf8');
      const v = buf.trim();
      if (v) return v;
    } catch { /* try next */ }
  }
  return null;
}

function readDarwinPlatformUuid() {
  const res = spawnSync('ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'], { encoding: 'utf8' });
  if (res.status !== 0) return null;
  const m = res.stdout.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/);
  return m ? m[1].trim() : null;
}

function hashLegacyMacFingerprint() {
  const interfaces = os.networkInterfaces();
  const macs = [];
  for (const list of Object.values(interfaces)) {
    if (!list) continue;
    for (const iface of list) {
      if (iface.internal) continue;
      if (iface.mac && iface.mac !== '00:00:00:00:00:00') macs.push(iface.mac);
    }
  }
  macs.sort();
  return hash(`${os.hostname()}|mac|${macs.join(',')}`);
}

function hash(seed) {
  return crypto.createHash('sha256').update(seed).digest('hex').slice(0, 32);
}
