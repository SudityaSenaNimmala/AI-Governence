// Platform dispatcher for "local TCP port → PID".
//
// Each impl exposes:
//   ensureStarted({ log })       — one-time warmup (Windows uses a long-lived
//                                  PowerShell helper; Linux/macOS are no-ops)
//   pidForLocalPort(port) → pid|null

import process from 'node:process';

let impl = null;

async function load() {
  if (impl) return impl;
  if (process.platform === 'linux')       impl = await import('./port-lookup-linux.js');
  else if (process.platform === 'win32')  impl = await import('./port-lookup-win32.js');
  else if (process.platform === 'darwin') impl = await import('./port-lookup-darwin.js');
  else impl = { ensureStarted: () => {}, pidForLocalPort: async () => null };
  return impl;
}

export async function ensureStarted(opts) {
  const m = await load();
  m.ensureStarted?.(opts);
}

export async function pidForLocalPort(port) {
  const m = await load();
  return m.pidForLocalPort(port);
}
