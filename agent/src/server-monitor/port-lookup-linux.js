// Linux equivalent of process-resolver-win32.js.
//
// Given a TCP local port (the ephemeral port a client opened on its side when
// connecting to our proxy), return the PID of the process that owns that
// socket. Lookup is two-stage:
//
//   1. Parse /proc/net/tcp and /proc/net/tcp6 to find the inode for the local
//      port. Format: each line has columns; column 9 is "inode" and column 1
//      contains "local_addr:local_port" in hex.
//
//   2. Walk /proc/<pid>/fd/* — each fd is a symlink; sockets appear as
//      "socket:[INODE]". Match against the inode from step 1.
//
// This is O(processes × open_fds) per lookup. For server-agent traffic volume
// (hundreds of req/min, not thousands) it's fine without optimization. The
// inode→pid index could be cached if we ever need to scale.

import fs from 'node:fs/promises';
import path from 'node:path';

const PROC = '/proc';

export async function pidForLocalPort(port) {
  if (!Number.isFinite(port) || port <= 0) return null;
  const inode = await findInodeForPort(port);
  if (inode == null) return null;
  return await pidForInode(inode);
}

async function findInodeForPort(port) {
  const portHex = port.toString(16).toUpperCase().padStart(4, '0');
  for (const fname of ['net/tcp', 'net/tcp6']) {
    const text = await readSafe(path.join(PROC, fname));
    if (!text) continue;
    // Skip the header line.
    const lines = text.split('\n').slice(1);
    for (const line of lines) {
      // Columns are whitespace-separated; collapse runs.
      const cols = line.trim().split(/\s+/);
      if (cols.length < 10) continue;
      const localAddr = cols[1];                  // e.g. "0100007F:1F90"
      const inode = cols[9];
      const colonIdx = localAddr.lastIndexOf(':');
      if (colonIdx < 0) continue;
      const localPortHex = localAddr.slice(colonIdx + 1);
      if (localPortHex === portHex) return inode;
    }
  }
  return null;
}

async function pidForInode(inode) {
  const target = `socket:[${inode}]`;
  const entries = await readSafe(PROC, /* isDir */ true);
  if (!entries) return null;
  for (const name of entries) {
    if (!/^\d+$/.test(name)) continue;
    const fdDir = path.join(PROC, name, 'fd');
    let fds;
    try { fds = await fs.readdir(fdDir); } catch { continue; }
    for (const fd of fds) {
      try {
        const link = await fs.readlink(path.join(fdDir, fd));
        if (link === target) return Number(name);
      } catch {}
    }
  }
  return null;
}

async function readSafe(p, isDir = false) {
  try {
    return isDir ? await fs.readdir(p) : await fs.readFile(p, 'utf8');
  } catch { return null; }
}

export function ensureStarted() { /* no-op on Linux; /proc is always available */ }
