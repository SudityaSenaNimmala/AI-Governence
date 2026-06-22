// Platform dispatcher for process attribution.
//
// All platform impls expose the same shape:
//   attribute(pid) → {
//     pid, uid, loginuid, user, cmdline, exe, cwd,
//     parent_chain, trigger_source, started_at
//   }
//
// Linux is the richest (loginuid for sudo-survival); Windows/macOS return
// the same fields but with null where the OS doesn't provide an equivalent.

import process from 'node:process';

let impl = null;

async function load() {
  if (impl) return impl;
  if (process.platform === 'linux') {
    impl = await import('./attribution-linux.js');
  } else if (process.platform === 'win32') {
    impl = await import('./attribution-win32.js');
  } else if (process.platform === 'darwin') {
    impl = await import('./attribution-darwin.js');
  } else {
    impl = { attribute: async () => null };
  }
  return impl;
}

export async function attribute(pid) {
  const m = await load();
  return m.attribute(pid);
}
