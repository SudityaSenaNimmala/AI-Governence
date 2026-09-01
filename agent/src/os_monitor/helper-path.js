// Where the PowerShell helpers live — correct in a source checkout AND inside the
// packaged single-file binary.
//
// WHY THIS EXISTS RATHER THAN `import.meta.url`.
//
// Four modules used to locate their .ps1 with:
//
//     const __dirname = dirname(fileURLToPath(import.meta.url));
//
// That is fine under Node's ESM loader and fatal once bundled. esbuild compiles
// this tree to CommonJS for Node SEA, and `import.meta` has no meaning there — it
// emits a literal `var import_meta = {}`, so `import_meta.url` is undefined,
// `fileURLToPath(undefined)` throws ERR_INVALID_ARG_TYPE at MODULE LOAD, and the
// binary dies before printing a single line:
//
//     TypeError: The "path" argument must be of type string or an instance of URL
//         at fileURLToPath (node:internal/url:1507:11)
//         at embedderRunCjs (node:internal/main/embedding:89:10)
//
// Observed on a real build, not predicted. It is also invisible until the binary
// is actually executed: esbuild reports it as a warning, the build succeeds, the
// .exe is produced at the expected size, and only running it reveals that nothing
// works at all.
//
// The packaged binary keeps its helpers beside the .exe (build-claude-tracker.mjs
// stages them), so process.execPath is the authoritative answer there. A source
// checkout keeps them beside this file. Both are tried, and existence decides.

import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Absolute path to a PowerShell helper that ships beside the agent.
 *
 * Returns the first candidate that exists. When none do it returns the
 * beside-the-executable path anyway, so the caller's own "missing helper" error
 * names the location an operator should be looking at rather than a build-time
 * path that means nothing on their machine.
 *
 * @param {string} name e.g. 'enforcer-win.ps1'
 */
export function helperScript(name) {
  const candidates = [];

  // 1. Beside the executable. In the packaged binary this is the install
  //    directory; running from source it is wherever node lives, which simply
  //    will not match and falls through.
  const besideExe = join(dirname(process.execPath), name);
  candidates.push(besideExe);

  // 2. Beside this module. `__dirname` is real in the CommonJS bundle, and
  //    `typeof` on an undeclared identifier is safe rather than a ReferenceError,
  //    so this costs nothing under ESM.
  try {
    // eslint-disable-next-line no-undef
    if (typeof __dirname === 'string') candidates.push(join(__dirname, name));
  } catch { /* not CJS */ }

  // 3. ESM source, via import.meta. Wrapped because in the CJS bundle this is
  //    exactly the throw described above — here it is caught instead of fatal.
  try {
    candidates.push(join(dirname(fileURLToPath(import.meta.url)), name));
  } catch { /* bundled — candidates 1 and 2 cover it */ }

  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return besideExe;
}
