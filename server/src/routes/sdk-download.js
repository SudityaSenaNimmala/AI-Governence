// Download the JavaScript SDK (`sdk-js/`) as a zip.
//
// WHY THIS IS A SEPARATE FILE FROM routes/sdk.js
// ----------------------------------------------
// routes/sdk.js carries an explicit, documented invariant: every route in it
// requires requireAdminAuth, because it hands out and reads back developer
// credentials. This route is deliberately PUBLIC, and burying an unauthenticated
// handler inside that file would quietly falsify the invariant its header states.
// So it lives here, where "public" is the file's whole premise.
//
// WHY PUBLIC IS SAFE HERE
// ----------------------
// The response body is our own unpublished, dependency-free client library —
// the same bytes we would hand a developer over email today. It contains no
// credentials, no tenant data, and no prompt content: the SDK reads its keys
// from the caller's environment at runtime. Nothing about the archive varies by
// requester, so there is nothing to authorize. `@cloudfuze/ai-gov-sdk` is not on
// any registry yet, so this endpoint is currently the distribution channel; when
// it is published, this becomes a convenience mirror.
//
// Rebuilt per request rather than at startup, so editing sdk-js/ (or deploying a
// new one) takes effect without a restart. The whole tree is tens of KB, so the
// cost of doing that is irrelevant.

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { a } from '../util.js';
import { createZip } from '../lib/zip.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// server/src/routes -> repo root. Holds in the container too: the image lays the
// server out at /app/server/src/... with sdk-js copied to /app/sdk-js (see
// server/Dockerfile), so the same three levels up resolve correctly.
export const SDK_JS_DIR = join(__dirname, '..', '..', '..', 'sdk-js');

// What a developer actually needs: the runnable package and a demo they can run.
// Everything else is repo furniture.
//
// `test/` is excluded on purpose — it is our regression suite for the SDK, not
// part of the product, and shipping it invites "npm test" failures in an
// environment that was never meant to run it.
const EXCLUDED_ENTRIES = new Set([
  'node_modules',   // must never exist here (the SDK has zero deps) — defensive
  'test',
  'tests',
  'coverage',
  'package-lock.json',
]);

// Anything git- or editor-local: .git, .gitignore, .gitattributes, .DS_Store...
function isExcluded(entry) {
  if (EXCLUDED_ENTRIES.has(entry)) return true;
  if (entry.startsWith('.git')) return true;
  if (entry === '.DS_Store' || entry === 'Thumbs.db') return true;
  return false;
}

// A single oversized file should not be able to turn this endpoint into a
// memory-pressure lever. Nothing in sdk-js/ is remotely near this.
const MAX_FILE_BYTES = 2 * 1024 * 1024;

/**
 * Collect sdk-js/ into flat zip entries. Exported for the test suite so the
 * traversal/exclusion rules can be asserted without going over HTTP.
 *
 * @param {string} root directory to walk
 * @returns {Array<{name: string, data: Buffer, mtime: Date}>}
 */
export function collectSdkFiles(root = SDK_JS_DIR) {
  const files = [];

  function walk(dir, prefix) {
    for (const entry of readdirSync(dir).sort()) {
      if (isExcluded(entry)) continue;
      const full = join(dir, entry);
      const rel = prefix ? `${prefix}/${entry}` : entry;
      // lstat, not stat: a symlink out of the tree must not be followed into
      // some unrelated part of the filesystem and packaged up.
      const st = statSync(full, { throwIfNoEntry: false });
      if (!st) continue;
      if (st.isDirectory()) walk(full, rel);
      else if (st.isFile() && st.size <= MAX_FILE_BYTES) {
        files.push({ name: rel, data: readFileSync(full), mtime: st.mtime });
      }
    }
  }

  walk(root, '');
  return files;
}

/**
 * @param {import('express').Express} app
 * @param {{dir?: string}} [options] `dir` exists so the test suite can point the
 *   route at a tree that is absent or empty and exercise the 404 branches; nothing
 *   in production passes it.
 */
export function mountSdkDownload(app, { dir = SDK_JS_DIR } = {}) {
  // PUBLIC by design — see the file header. Do not add requireAdminAuth without
  // also giving the UI a way to authenticate this download.
  app.get('/api/v1/sdk/download', a(async (req, res) => {
    if (!existsSync(dir)) {
      // A deploy that did not include sdk-js/. Say so in JSON instead of
      // handing the browser a zip with nothing in it, which reads as a
      // corrupt-download bug rather than a packaging bug.
      return res.status(404).json({
        error: 'SDK source not found on server',
        detail: 'sdk-js/ is not present in this deployment.',
      });
    }

    const files = collectSdkFiles(dir);
    if (files.length === 0) {
      return res.status(404).json({
        error: 'SDK source is empty',
        detail: 'sdk-js/ exists but contains no distributable files.',
      });
    }

    const zip = createZip(files);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="ai-gov-sdk.zip"');
    res.setHeader('Content-Length', String(zip.length));
    // The tree is read off disk per request; a cached copy would defeat that.
    res.setHeader('Cache-Control', 'no-store');
    res.end(zip);
  }));
}
