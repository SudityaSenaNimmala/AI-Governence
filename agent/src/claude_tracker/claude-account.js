// Discovers which Claude account is signed in on this machine.
//
// Why this matters for reporting: Claude Code reports its usage against the
// signed-in OAuth email, while the desktop/browser watcher can only see the OS
// username. Without linking the two, one person shows up as two different users
// on the dashboard. Reading the account email here lets the server merge them
// into a single person per machine.
//
// Read-only, and only these fields. Tokens in this file are never read or sent.

import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export async function detectClaudeAccount() {
  // Claude Code keeps the signed-in account in ~/.claude.json under oauthAccount.
  const candidates = [
    join(homedir(), '.claude.json'),
    join(homedir(), '.claude', 'claude.json'),
  ];

  for (const path of candidates) {
    try {
      const parsed = JSON.parse(await readFile(path, 'utf8'));
      const oa = parsed?.oauthAccount;
      if (oa?.emailAddress) {
        return {
          email: String(oa.emailAddress).toLowerCase(),
          displayName: oa.displayName || null,
          organization: oa.organizationName || null,
          source: path,
        };
      }
    } catch {
      // Missing or unparseable — try the next candidate. Not being able to read
      // this is not an error: the tracker still reports under the OS username.
    }
  }
  return null;
}
