// `blocked_agents.agent_scope` — how WIDE a block row is.
//
// A blocked_agents row has always named one specific agent
// ({ agent_name: "AI Learning Advisor", platform: "personal_agent" }), but the
// desktop enforcer matched it against the whole PROCESS set the platform maps to
// and used agent_name only as display text. Blocking one agent therefore
// disabled the entire host app — generic Copilot chat and every other agent in
// it included.
//
// This field is what lets a row say which of the two it meant:
//
//   'platform' / absent / null — today's behaviour, unchanged: the whole process
//                                the platform maps to is blocked.
//   'agent'                    — narrow to the ONE agent in agent_name, when the
//                                enforcing surface can actually tell which agent
//                                is open. When it cannot, the enforcer falls back
//                                to the whole-app block rather than enforcing
//                                nothing (fail closed) — see
//                                agent/src/os_monitor/ai-processes.js's
//                                AGENT_SURFACES and enforcer-win.ps1's
//                                CheckFgBlocked.
//
// Kept in its own module rather than inline in the route so the validation is
// unit-testable without a Mongo connection, and so the enum has exactly one
// definition on the server side.
export const AGENT_SCOPES = ['agent', 'platform'] as const;

export type AgentScope = (typeof AGENT_SCOPES)[number];

// Absent / null / '' → null (the default, meaning platform-wide). A recognised
// value → itself, lower-cased and trimmed. ANYTHING ELSE → undefined, which the
// caller must turn into a 400 rather than silently storing: a typo'd scope that
// defaulted to platform-wide would look like it had been applied while the block
// stayed as coarse as before, and a typo'd scope that defaulted to 'agent' would
// silently narrow a block an admin meant to be app-wide. Neither is acceptable,
// so an unrecognised value is refused.
export function normalizeAgentScope(value: unknown): AgentScope | null | undefined {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') return undefined;
  const scope = value.trim().toLowerCase();
  if (scope === '') return null;
  return (AGENT_SCOPES as readonly string[]).includes(scope) ? (scope as AgentScope) : undefined;
}
