import crypto from 'node:crypto';
import { toolKeyFor } from '../db.js';
import { requireMachineAuth } from '../auth.js';
import { a } from '../util.js';
import { scoreFinding } from '../risk.js';

export function mountReports(app, db) {
  app.post('/api/v1/reports', requireMachineAuth, a(async (req, res) => {
    const report = req.body;
    if (!report || typeof report !== 'object' || !report.machine || !report.scan) {
      return res.status(400).json({ error: 'invalid report shape' });
    }

    if (report.machine.id !== req.machine.id) {
      return res.status(403).json({ error: 'token machine_id does not match report machine_id' });
    }

    const validated = validateReport(report);
    if (validated.error) return res.status(400).json({ error: validated.error });

    const result = await saveReport(db, report);
    res.status(201).json(result);
  }));
}

function validateReport(report) {
  for (const f of report.findings ?? []) {
    if (f.type === 'api_key' && typeof f.value === 'string') {
      return { error: 'rejected: api_key finding included raw value (must be fingerprint only)' };
    }
    if (f.type === 'browser_ai_visit' && f.url) {
      return { error: 'rejected: browser_ai_visit must not include URL, only domain' };
    }
    if (f.type === 'agent_project' && f.fileContents) {
      return { error: 'rejected: agent_project must not include file contents' };
    }
  }
  return { ok: true };
}

async function saveReport(db, report) {
  const machine = report.machine;
  const scan = report.scan;
  const findings = report.findings ?? [];
  const now = new Date();

  // Upsert machine
  await db.collection('machines').updateOne(
    { id: machine.id },
    {
      $set: {
        id: machine.id,
        hostname: machine.hostname ?? null,
        user: machine.user ?? null,
        platform: report.agent?.platform ?? null,
        os_release: machine.osRelease ?? null,
        last_seen: now,
      },
      $setOnInsert: { first_seen: now },
    },
    { upsert: true },
  );

  // Insert scan
  const scanId = crypto.randomUUID();
  await db.collection('scans').insertOne({
    id: scanId,
    machine_id: machine.id,
    agent_version: report.agent?.version ?? null,
    started_at: scan.startedAt,
    finished_at: scan.finishedAt,
    duration_ms: scan.durationMs ?? null,
    findings_count: findings.length,
    errors_count: (report.errors ?? []).length,
    raw_json: JSON.stringify(report),
    received_at: now,
  });

  // Insert findings
  for (const f of findings) {
    await db.collection('findings').insertOne({
      id: crypto.randomUUID(),
      scan_id: scanId,
      machine_id: machine.id,
      detector: f.detector ?? 'unknown',
      type: f.type,
      vendor: f.vendor ?? null,
      product: f.product ?? null,
      provider: f.provider ?? null,
      tool_key: toolKeyFor(f),
      risk_score: scoreFinding(f),
      payload_json: JSON.stringify(f),
      detected_at: now,
    });
  }

  return { ok: true, scanId, findingsStored: findings.length };
}
