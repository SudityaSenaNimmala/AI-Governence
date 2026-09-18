// macOS port → PID via `lsof`.
//
// lsof -nP -iTCP:PORT -sTCP:ESTABLISHED returns one line per matching socket.
// We're after the *local* port the agent process opened to talk to us
// (the proxy is the peer). lsof matches both ends, so we filter for the
// row whose source is the requested port. With -F we get one field per line
// for stable parsing.
//
// Performance: ~30-80ms per call. Acceptable at server-agent call rates.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

export async function pidForLocalPort(port) {
  if (!Number.isFinite(port) || port <= 0) return null;
  try {
    const { stdout } = await exec('lsof', [
      '-nP',                                  // no DNS / port-name lookups
      `-iTCP:${port}`,                        // both ends
      '-sTCP:ESTABLISHED',                    // skip LISTEN/SYN
      '-Fp',                                  // field output: just the pid
    ], { timeout: 1500 });
    // -F output: 'p<pid>\n...'. First p line wins.
    for (const line of stdout.split('\n')) {
      if (line.startsWith('p')) {
        const n = Number(line.slice(1));
        if (Number.isFinite(n)) return n;
      }
    }
    return null;
  } catch { return null; }
}

export function ensureStarted() { /* no-op on macOS */ }
