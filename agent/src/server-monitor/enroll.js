// One-shot enrollment for the server-monitor daemon.
//
// Persists machineId + bearer token to a local JSON file so the daemon survives
// restarts without re-enrolling. File mode 0600 (root-only) since the token
// authenticates the daemon to the governance server.
//
// On first boot:
//   - generate a stable machineId (host UUID if available, else random)
//   - POST /api/v1/enroll with the enroll secret
//   - persist { machineId, hostname, token } to TOKEN_FILE

import fs from 'node:fs/promises';
import os from 'node:os';
import crypto from 'node:crypto';
import path from 'node:path';

const DEFAULT_TOKEN_FILE = '/etc/cloudfuze/server-monitor.token.json';

export async function ensureEnrolled({ serverUrl, enrollSecret, tokenFile = DEFAULT_TOKEN_FILE, log }) {
  const existing = await loadExisting(tokenFile);
  if (existing?.token && existing.machineId) {
    log?.info?.(`enroll: reusing existing machineId=${existing.machineId}`);
    return existing;
  }

  const machineId = await deriveMachineId();
  const hostname = os.hostname();

  const res = await fetch(`${serverUrl.replace(/\/+$/, '')}/api/v1/enroll`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ machineId, hostname, enrollSecret }),
  });
  if (!res.ok) throw new Error(`enroll failed: ${res.status} ${await res.text().catch(() => '')}`);
  const { token } = await res.json();

  const record = { machineId, hostname, token, enrolledAt: new Date().toISOString() };
  await persist(tokenFile, record);
  log?.info?.(`enroll: new machineId=${machineId} hostname=${hostname}`);
  return record;
}

async function loadExisting(file) {
  try {
    const txt = await fs.readFile(file, 'utf8');
    return JSON.parse(txt);
  } catch { return null; }
}

async function persist(file, record) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(record, null, 2), { mode: 0o600 });
}

// Stable machineId: prefer /etc/machine-id (systemd standard), then fall back
// to /var/lib/dbus/machine-id, then to a random one persisted locally.
async function deriveMachineId() {
  for (const p of ['/etc/machine-id', '/var/lib/dbus/machine-id']) {
    try {
      const v = (await fs.readFile(p, 'utf8')).trim();
      if (v) return v;
    } catch {}
  }
  return crypto.randomBytes(16).toString('hex');
}
