import os from 'node:os';
import { getMachineId } from './util/machine.js';
import { resolveCorporateUser } from './util/corporate-identity.js';
import { getUserPaths } from './util/paths.js';

// Version is injected at build time by esbuild's `define`. Falls back for dev runs.
const AGENT_VERSION = typeof __AGENT_VERSION__ === 'string' ? __AGENT_VERSION__ : '0.1.0-dev';

export async function loadConfig({ only = [], skip = [] } = {}) {
  const pkg = { version: AGENT_VERSION };

  const platform = process.platform;
  const machineId = await getMachineId();
  const paths = getUserPaths(platform);

  return {
    agentVersion: pkg.version,
    platform,
    arch: process.arch,
    hostname: os.hostname(),
    osRelease: os.release(),
    machineId,
    // The corporate UPN where there is one, so this agent, the browser extension
    // and the Claude Code CLI all name the same person with the same string.
    // Falls back to the OS username on a machine with no work identity.
    user: resolveCorporateUser(),
    paths,
    only,
    skip,
    // 30s is plenty for fast detectors. deep_filesystem has its own internal
    // budget (~4 min) and we don't want the outer timeout to kill it early.
    perDetectorTimeoutMs: 5 * 60_000,
  };
}
