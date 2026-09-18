import { detectors } from './detectors/index.js';

export async function runScan({ config, log }) {
  const startedAt = Date.now();

  const selected = detectors.filter((d) => {
    if (!d.platforms.includes(config.platform)) return false;
    if (config.only.length && !config.only.includes(d.name)) return false;
    if (config.skip.includes(d.name)) return false;
    return true;
  });

  log.debug(`Running ${selected.length} detectors: ${selected.map((d) => d.name).join(', ')}`);

  const detectorReports = await Promise.all(
    selected.map((d) => runDetectorWithTimeout(d, config, log))
  );

  const findings = [];
  const errors = [];
  for (const r of detectorReports) {
    for (const f of r.findings) findings.push({ ...f, detector: r.detector });
    for (const e of r.errors) errors.push({ ...e, detector: r.detector });
  }

  return {
    schemaVersion: 1,
    agent: {
      version: config.agentVersion,
      platform: config.platform,
      arch: config.arch,
    },
    machine: {
      id: config.machineId,
      hostname: config.hostname,
      osRelease: config.osRelease,
      user: config.user,
    },
    scan: {
      startedAt: new Date(startedAt).toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
    },
    summary: {
      detectorsRun: selected.length,
      findingsCount: findings.length,
      errorsCount: errors.length,
      durationMs: Date.now() - startedAt,
    },
    detectors: detectorReports.map((r) => ({
      name: r.detector,
      stats: r.stats,
      errors: r.errors.length,
    })),
    findings,
    errors,
  };
}

async function runDetectorWithTimeout(detector, config, log) {
  const start = Date.now();
  const ctx = {
    platform: config.platform,
    paths: config.paths,
    machineId: config.machineId,
    log: log.child(detector.name),
  };

  const timeoutMs = config.perDetectorTimeoutMs;
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`detector ${detector.name} timed out after ${timeoutMs}ms`)), timeoutMs);
  });

  try {
    const result = await Promise.race([detector.detect(ctx), timeout]);
    clearTimeout(timer);
    const duration = Date.now() - start;
    log.debug(`detector ${detector.name} produced ${result.findings.length} findings in ${duration}ms`);
    return {
      detector: detector.name,
      findings: result.findings ?? [],
      errors: result.errors ?? [],
      stats: { ...(result.stats ?? {}), durationMs: duration },
    };
  } catch (err) {
    clearTimeout(timer);
    log.warn(`detector ${detector.name} failed: ${err.message}`);
    return {
      detector: detector.name,
      findings: [],
      errors: [{ message: err.message, recoverable: false }],
      stats: { durationMs: Date.now() - start },
    };
  }
}
