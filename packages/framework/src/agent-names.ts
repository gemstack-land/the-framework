/**
 * The agent vocabulary (#542), node-free so every surface shares one copy: the CLI's
 * `--agent` flag, the registry's preference sanitizer, and the dashboard bundle — which must
 * not import the driver layer (it spawns processes), and whose "kept local" copies existed
 * only because this list used to live beside those imports. Adding an agent is one entry
 * here plus its driver; the dashboard's per-agent UI table is keyed by {@link AgentName}, so
 * a missing entry there is a compile error, not a silent gap.
 */

/** The agents the framework can drive, in the order surfaces list them. */
export const AGENTS = ['claude', 'codex'] as const

/** An agent `--agent` can name. */
export type AgentName = (typeof AGENTS)[number]

/** Whether `value` names an agent we can drive. */
export function isAgentName(value: string | undefined): value is AgentName {
  return value !== undefined && (AGENTS as readonly string[]).includes(value)
}

/** How each agent reads in a sentence or on a button. */
export const AGENT_LABELS: Record<AgentName, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
}

/**
 * The agent behind a driver name (#831): a run records the driver that ran it
 * (`claude-code`), while `--agent` takes the agent name (`claude`). `undefined` for a driver
 * no agent claims (the fake driver, or a record from a newer version). An agent whose driver
 * name differs from its own needs a case here, like claude's does.
 */
export function agentForDriver(driver: string | undefined): AgentName | undefined {
  if (driver === 'claude-code') return 'claude'
  return isAgentName(driver) ? driver : undefined
}
