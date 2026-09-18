import { stat, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function exists(p) {
  try { await stat(p); return true; } catch { return false; }
}

export async function safeReaddir(p) {
  try { return await readdir(p, { withFileTypes: true }); } catch { return []; }
}

export async function safeStat(p) {
  try { return await stat(p); } catch { return null; }
}

export async function safeReadJson(p) {
  try { return JSON.parse(await readFile(p, 'utf8')); } catch { return null; }
}

export async function safeReadText(p, maxBytes = 1_000_000) {
  try {
    const s = await stat(p);
    if (s.size > maxBytes) return null;
    return await readFile(p, 'utf8');
  } catch { return null; }
}

export function joinSafe(...parts) {
  return join(...parts.filter(Boolean));
}
