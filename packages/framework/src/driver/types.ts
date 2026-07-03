/**
 * The **driver** seam: the one abstraction The Framework wraps a coding-agent
 * CLI behind. A driver treats the agent (Claude Code today, Codex / opencode
 * later) as a **black box**: we hand it a prompt, let its *own* loop run to
 * completion, then read the code it produced and gate on the outcome ourselves.
 *
 * The seam is deliberately the **code and the outcome**, never the agent's
 * individual tool calls (guardrail from #165). We drive by prompting and verify
 * by result (builds / serves / review-passes), so the wrapped agent keeps its
 * subscription-based auth and its internal loop stays untouched and swappable.
 *
 * Decision (#166, option A): a single execution path. Everything runs *through*
 * the driver; personas become prompt-framing ({@link DriverStartOptions.system}),
 * and each loop pass (review / security / QA / UX) is a **fresh** {@link
 * DriverSession.prompt} call, so `prompt` is the fresh-context unit.
 *
 * `Driver` is intentionally tiny: `start` a session, `prompt` it, read the code,
 * `dispose`. It mirrors the runner seam's shape so a second agent slots in behind
 * the same three methods.
 */

/** A wrapped coding-agent CLI. Boots {@link DriverSession}s bound to a workspace. */
export interface Driver {
  /** Stable name for the wrapped agent, e.g. `"claude-code"`. */
  readonly name: string
  /** Boot a session bound to a workspace directory. */
  start(opts: DriverStartOptions): Promise<DriverSession>
}

/** How to boot a {@link DriverSession}. */
export interface DriverStartOptions {
  /** Absolute path to the workspace the agent reads and edits. */
  cwd: string
  /**
   * Role framing prepended to every prompt in this session (option A: personas
   * are prompt-framing, not a separate agent). Maps to the agent's system prompt.
   */
  system?: string
  /** Model id to pass through when the wrapped agent supports selecting one. */
  model?: string
  /** Abort the whole session; disposing kills the underlying process. */
  signal?: AbortSignal
  /**
   * Observe the agent's *own* progress as it works. Black-box granularity: we
   * forward these for visibility (the dashboard) but never branch control flow
   * on them. Isolated: a throwing callback must not break the run.
   */
  onEvent?: (event: DriverEvent) => void
}

/** A booted agent session, bound to one workspace. */
export interface DriverSession {
  /** Stable id (the agent's own session id when it exposes one). */
  readonly id: string
  /** Absolute workspace path the agent is bound to. */
  readonly cwd: string
  /**
   * Send one prompt, let the agent's built-in loop run to completion, and
   * resolve with its final turn. Each call is a **fresh** invocation (fresh
   * context per loop pass) unless a driver documents otherwise.
   */
  prompt(text: string, opts?: DriverPromptOptions): Promise<DriverTurn>
  /**
   * Read a file the agent produced (the seam is the code). Optional: a driver
   * whose workspace is not host-readable may omit it and rely on a runner.
   */
  readCode?(path: string): Promise<string>
  /** Tear the session down (kill the process, free resources). Idempotent. */
  dispose(): Promise<void>
}

/** Per-prompt overrides. */
export interface DriverPromptOptions {
  /** Extra framing for just this prompt, appended after the session `system`. */
  system?: string
  /** Abort just this prompt (the in-flight invocation). */
  signal?: AbortSignal
}

/** The outcome of one {@link DriverSession.prompt} turn. */
export interface DriverTurn {
  /** The agent's final assistant text for this prompt. */
  text: string
  /**
   * The agent's session id for this turn, when it exposes one. The MVP
   * persistence shortcut is to forward the agent's own transcript rather than
   * keep our own store (#165), so this is the handle a UI links to.
   */
  sessionId?: string
}

/**
 * A black-box progress event from the wrapped agent. We forward these to the
 * dashboard for visibility but never gate on them: the loop gates on the code /
 * outcome, not on which tool the agent reached for.
 */
export type DriverEvent =
  /** A prompt was sent; the agent's loop is starting. */
  | { type: 'start'; prompt: string }
  /** An assistant text chunk streamed out. */
  | { type: 'text'; text: string }
  /** The agent used a tool. We surface the name only, not the arguments. */
  | { type: 'action'; label: string }
  /** The turn settled with this final text. */
  | { type: 'result'; text: string; sessionId?: string }
  /** The agent (or its transport) errored. */
  | { type: 'error'; message: string }
