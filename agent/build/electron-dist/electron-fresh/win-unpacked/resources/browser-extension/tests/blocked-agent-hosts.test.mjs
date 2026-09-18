// PLATFORM_TO_HOSTS gates which hostnames the blocked-agent enforcer even looks
// at for a given agent platform. A Copilot Studio agent's own registry entry
// already lists Teams/Outlook/SharePoint in matched_hosts (that's where it was
// discovered), but this map used to stop at the standalone Copilot chat
// surfaces (copilot.microsoft.com, m365.cloud.microsoft, powerva.ms), so a
// blocked agent published into Teams or Outlook went unenforced there — the
// block looked live in AI Hub but did nothing on those hosts. Pinned on
// shipped source, matching this file's sibling tests, since PLATFORM_TO_HOSTS
// is a literal object mid-IIFE with no test seam.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const CONTENT = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'content', 'content.js'),
  'utf8',
);

const at = CONTENT.indexOf('const PLATFORM_TO_HOSTS');
const end = CONTENT.indexOf('};', at);
const block = CONTENT.slice(at, end);

test('copilot_studio coverage includes the Copilot chat surfaces', () => {
  const line = block.match(/copilot_studio:\s*\[([^\]]*)\]/)[1];
  assert.match(line, /copilot\\\.microsoft/);
  assert.match(line, /m365\\\.cloud\\\.microsoft/);
  assert.match(line, /powerva\\\.ms/);
  assert.match(line, /copilotstudio/);
});

test('copilot_studio coverage also includes Teams, Outlook, and SharePoint', () => {
  const line = block.match(/copilot_studio:\s*\[([^\]]*)\]/)[1];
  assert.match(line, /teams\\\.microsoft/, 'a Copilot Studio agent published into Teams must still be enforced');
  assert.match(line, /outlook\\\.office/, 'Outlook web is a real surface for these agents too');
  assert.match(line, /outlook\\\.live/);
  assert.match(line, /sharepoint\\\.com/);
  assert.match(line, /office\\\.com/);
  assert.match(line, /office365\\\.com/);
  assert.match(line, /microsoft365\\\.com/);
});
