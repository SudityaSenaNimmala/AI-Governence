import { readFile, writeFile, mkdir, chmod } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import os from 'node:os';

const CRED_DIR = join(os.homedir(), '.cloudfuze-aigov');
const CRED_PATH = join(CRED_DIR, 'credentials.json');

export async function loadCredentials() {
  try {
    const raw = await readFile(CRED_PATH, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function saveCredentials(creds) {
  await mkdir(CRED_DIR, { recursive: true });
  await writeFile(CRED_PATH, JSON.stringify(creds, null, 2), 'utf8');
  // Best-effort restrictive permissions on POSIX (no-op on Windows).
  try { await chmod(CRED_PATH, 0o600); } catch {}
  return CRED_PATH;
}

export async function enroll({ serverUrl, machineId, hostname, enrollSecret }) {
  const res = await fetch(`${serverUrl.replace(/\/$/, '')}/api/v1/enroll`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ machineId, hostname, enrollSecret }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`enrollment failed (${res.status}): ${text}`);
  }
  const body = await res.json();
  const creds = {
    serverUrl: serverUrl.replace(/\/$/, ''),
    machineId: body.machineId,
    token: body.token,
    enrolledAt: new Date().toISOString(),
  };
  await saveCredentials(creds);
  return creds;
}
