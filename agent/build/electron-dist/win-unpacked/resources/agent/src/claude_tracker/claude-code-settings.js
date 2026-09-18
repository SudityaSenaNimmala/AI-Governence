// Turns on Claude Code CLI telemetry so the server receives real token counts
// and cost (claude_code.api_request). This automates the manual step documented
// in agent/claude-code-cli-telemetry.settings.json.
//
// We merge into the USER settings file (~/.claude/settings.json) rather than the
// org-wide managed-settings.json, because managed-settings lives under
// C:\ProgramData and needs admin rights a tester may not have. The merge is
// non-destructive: existing keys are preserved and only our env vars are set.

import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';

export function claudeSettingsPath() {
  return join(homedir(), '.claude', 'settings.json');
}

export function telemetryEnv(serverUrl) {
  return {
    CLAUDE_CODE_ENABLE_TELEMETRY: '1',
    OTEL_LOGS_EXPORTER: 'otlp',
    OTEL_EXPORTER_OTLP_PROTOCOL: 'http/json',
    OTEL_EXPORTER_OTLP_ENDPOINT: `${serverUrl.replace(/\/+$/, '')}/api/v1/otel`,
    OTEL_LOGS_EXPORT_INTERVAL: '5000',
  };
}

// Returns { changed, path, backedUp } so the caller can log honestly about
// whether it actually modified anything.
export async function ensureClaudeCodeTelemetry(serverUrl, log) {
  const path = claudeSettingsPath();
  const wanted = telemetryEnv(serverUrl);

  let existing = {};
  let raw = null;
  try {
    raw = await readFile(path, 'utf8');
    existing = JSON.parse(raw);
    if (existing === null || typeof existing !== 'object' || Array.isArray(existing)) {
      // A settings.json that isn't an object isn't something we should rewrite.
      log?.warn(`claude-tracker: ${path} is not a JSON object — leaving it alone`);
      return { changed: false, path, backedUp: false, reason: 'not-an-object' };
    }
  } catch (err) {
    if (err.code === 'ENOENT') {
      existing = {};
    } else if (err instanceof SyntaxError) {
      // Don't clobber a file we can't parse — a tester may have hand-edited it.
      log?.warn(`claude-tracker: ${path} is not valid JSON — leaving it alone`);
      return { changed: false, path, backedUp: false, reason: 'invalid-json' };
    } else {
      throw err;
    }
  }

  const env = { ...(existing.env || {}) };
  let changed = false;
  for (const [k, v] of Object.entries(wanted)) {
    if (env[k] !== v) { env[k] = v; changed = true; }
  }
  if (!changed) return { changed: false, path, backedUp: false, reason: 'already-configured' };

  // Back up an existing file once before the first rewrite.
  let backedUp = false;
  if (raw != null) {
    try {
      await copyFile(path, path + '.aigov-backup');
      backedUp = true;
    } catch { /* a missing backup is not worth failing the run over */ }
  }

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify({ ...existing, env }, null, 2) + '\n', 'utf8');
  return { changed: true, path, backedUp };
}
