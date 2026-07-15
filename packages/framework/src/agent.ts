import { ClaudeCodeDriver, CodexDriver, type ClaudeCodeDriverOptions, type Driver } from './driver/index.js'

/**
 * Which agent drives a run (#542). Each is a whole coding-agent CLI the user
 * already pays for, driven on their own subscription with no API key (#495).
 *
 * This is the table `--agent` picks from: adding the third agent is one entry
 * here plus its driver, not another branch at every call site.
 */
export const AGENTS = ['claude', 'codex'] as const

/** An agent `--agent` can name. */
export type AgentName = (typeof AGENTS)[number]

/** Whether `value` names an agent we can drive. */
export function isAgentName(value: string | undefined): value is AgentName {
  return value !== undefined && (AGENTS as readonly string[]).includes(value)
}

/** What we know about an agent before we run it. */
export interface AgentSpec {
  /** How to say it in a sentence, e.g. "Claude Code". */
  label: string
  /** The CLI binary, resolved on PATH. */
  bin: string
  /** Shown when preflight cannot find {@link bin}. */
  installHint: string
  /**
   * Whether the agent prices its own turns. When it doesn't, the spend cap
   * (#322) has no number to gate on and silently never fires, so the CLI says
   * so instead of implying a guard that isn't there (#540).
   */
  reportsCost: boolean
}

/** The agents we can drive, and what each can tell us about itself. */
export const AGENT_SPECS: Record<AgentName, AgentSpec> = {
  claude: {
    label: 'Claude Code',
    bin: 'claude',
    installHint: 'install Claude Code and make sure `claude` is on your PATH: https://claude.com/claude-code',
    reportsCost: true,
  },
  codex: {
    label: 'Codex',
    bin: 'codex',
    installHint: 'install the Codex CLI and make sure `codex` is on your PATH: https://developers.openai.com/codex/cli',
    reportsCost: false,
  },
}

/** Options for {@link createDriver}. */
export interface CreateDriverOptions {
  agent: AgentName
  /** Claude Code driver options. Ignored by any other agent, which has its own. */
  claudeOpts?: ClaudeCodeDriverOptions
}

/**
 * Build the {@link Driver} for the picked agent — the one place a run path turns
 * `--agent` into a real agent.
 *
 * Codex takes none of the Claude options: its sandbox is its own flag rather
 * than a permission mode, and it has no MCP config for `--browser`. Those are
 * dropped here and reported at the call site, so a flag that cannot apply says
 * so rather than looking honored.
 */
export function createDriver(opts: CreateDriverOptions): Driver {
  switch (opts.agent) {
    case 'codex':
      return new CodexDriver()
    case 'claude':
      return new ClaudeCodeDriver(opts.claudeOpts ?? {})
  }
}
