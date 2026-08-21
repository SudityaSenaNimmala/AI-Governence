// Settings that travel from the Electron main process into the spawned monitor
// child process.
//
// Transport is environment variables, matching how every other cross-process
// setting in the agent is passed (CFAI_AI_PROCESSES / CFAI_BLOCK_PATTERNS into
// the PowerShell helpers, CFAI_GUARD_* into the MCP guard). There is no IPC
// channel between Electron main and the monitor child — stdio is one-way,
// child → parent, and is used for log lines.
//
// The contract is deliberately trivial ('true' / 'false' strings, default ON
// when unset) because the Electron main process is CommonJS and cannot import
// this ESM module, so it re-implements the encoding side inline. Keep both
// sides in step; tests/os-monitor-safety.test.mjs asserts the main.js side.

export const ENFORCER_ENV_VAR = 'CFAI_ENFORCER_ENABLED';

/**
 * Encode the desktop app's `monitorEnforcer` setting for the child env.
 * Anything other than an explicit `false` means enabled — an absent setting
 * must never silently disable enforcement.
 */
export function enforcerEnvValue(settings) {
  return settings?.monitorEnforcer === false ? 'false' : 'true';
}

/**
 * Decode it in the child. Unset → enabled, so running the agent from the CLI
 * (no Electron) behaves exactly as it did before this variable existed.
 */
export function enforcerEnabledFromEnv(env = process.env) {
  return env?.[ENFORCER_ENV_VAR] !== 'false';
}
