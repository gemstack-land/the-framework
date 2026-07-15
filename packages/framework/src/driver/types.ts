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
  /**
   * Ask the agent where the account's subscription quota stands (#521), for the
   * consumption limits in #519. Account-wide and independent of any session, so
   * it hangs off the driver rather than off {@link DriverSession}.
   *
   * Optional: an agent that can't report it omits the method entirely, the same
   * way {@link DriverRateLimit} is omitted by drivers that can't emit it.
   */
  readQuota?(opts?: { signal?: AbortSignal }): Promise<DriverQuota>
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
  /** Token + cost accounting for this turn, when the agent reports it (#322). */
  usage?: DriverUsage
}

/**
 * Token and cost accounting for one turn, as reported by the wrapped agent (#322).
 * Claude Code emits this on its final `result` line; drivers that cannot report
 * it simply omit it. Costs are whatever the agent computed, in USD.
 *
 * Tokens are the part every agent reports; the price is the part only some do
 * (#540). So `costUsd` is optional and the tokens are not: Codex reports counts
 * and no price, and an agent that can't price a turn reports the tokens it does
 * know rather than nothing at all.
 */
export interface DriverUsage {
  /**
   * Cost of the turn in USD, when the agent prices its own turns. Omitted when it
   * doesn't — never `0`, which would read as free rather than as unknown.
   *
   * Note this is a notional price under a subscription: the user pays a flat fee,
   * and the agent reports what the turn would have cost on metered API pricing.
   * What a subscription actually spends is quota, which {@link DriverQuota}
   * carries and the consumption limits (#519) gate on.
   */
  costUsd?: number
  /** Non-cached input tokens. */
  inputTokens: number
  /** Output tokens. */
  outputTokens: number
  /** Tokens read from the prompt cache. */
  cacheReadTokens: number
  /** Tokens written to the prompt cache. */
  cacheCreationTokens: number
}

/**
 * Where the account's subscription quota stands, as reported by the wrapped
 * agent (#517). Claude Code emits one of these per turn on its `stream-json`
 * output; drivers that cannot report it simply omit it. This is the account
 * limit, not this run's spend — {@link DriverUsage} covers the latter.
 */
export interface DriverRateLimit {
  /**
   * Whether the account may still spend against this window: `allowed`,
   * `allowed_warning`, or `rejected`. Left open rather than a union — only
   * `allowed` has been observed, and a status we don't know is the signal we're
   * capturing for, so it must surface rather than be dropped.
   */
  status: string
  /**
   * Which quota window this reports on (`five_hour`, `seven_day`,
   * `seven_day_opus`, `seven_day_sonnet`, `weekly`). Left open for the same
   * reason: the agent adds windows as plans change.
   */
  window: string
  /** When the window resets, epoch **milliseconds** (the agent reports seconds). */
  resetsAt: number
}

/**
 * One quota window and how much of it the account has burned (#521).
 *
 * The three concepts here are easy to confuse. {@link DriverUsage} is what *this
 * run* spent. {@link DriverRateLimit} is a per-turn traffic light (are we still
 * allowed to spend, and when does the window reset). This is the missing middle:
 * the *proportion* of a window consumed, which is the only one of the three that
 * can fill a progress bar.
 */
export interface DriverQuotaWindow {
  /** The window's name exactly as the agent phrased it, e.g. `"Current session"`. */
  label: string
  /**
   * Normalized window, so callers can gate without matching on prose.
   * `session` is Claude's 5-hour window, `week` its all-models week, and
   * `week-model` a single model's week (Opus/Sonnet get their own).
   *
   * Note there is deliberately no `day`: Claude measures a 5-hour session and a
   * week, and nothing per day (#519 was specced against a daily limit that does
   * not exist).
   */
  kind: 'session' | 'week' | 'week-model' | 'unknown'
  /** How much of the window is gone, 0-100. */
  percentUsed: number
  /**
   * When the window resets, as the agent worded it (`"Jul 18 at 7am
   * (Asia/Jerusalem)"`). Prose, not a timestamp: the agent prints no year, so
   * parsing it to an epoch would be guesswork. {@link DriverRateLimit.resetsAt}
   * carries the exact epoch for the window it reports on.
   */
  resetsAtText?: string
}

/**
 * Why a quota read came back empty.
 *
 * The split that matters is transient vs authoritative. `fetch-failed` and
 * `timeout` describe *this attempt* (the agent's own usage fetch can be refused
 * upstream, with a penalty window), so a recent reading is still worth showing.
 * Every other reason describes the account or the install and is a statement
 * about the setup, so a retained reading must not outlive it.
 */
export type DriverQuotaUnavailableReason =
  /** The agent's own usage fetch failed, e.g. refused upstream. Transient. */
  | 'fetch-failed'
  /** The agent did not answer in time. Transient. */
  | 'timeout'
  /** The agent binary isn't installed or isn't on `PATH`. */
  | 'agent-not-found'
  /** The account has no subscription quota to report (e.g. API-key auth). */
  | 'no-subscription'
  /** The agent answered, but not in a shape we recognize (it reworded the readout). */
  | 'unrecognized'

/** Whether a {@link DriverQuotaUnavailableReason} describes this attempt rather than the setup. */
export function isTransientQuotaReason(reason: DriverQuotaUnavailableReason): boolean {
  return reason === 'fetch-failed' || reason === 'timeout'
}

/**
 * Where the account's subscription quota stands (#521), as a whole reading.
 *
 * Modelled as available-or-not rather than as an empty window list, so a caller
 * can't mistake "we couldn't ask" for "nothing is used".
 */
export type DriverQuota =
  | { available: true; windows: DriverQuotaWindow[] }
  | { available: false; reason: DriverQuotaUnavailableReason }

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
  | { type: 'result'; text: string; sessionId?: string; usage?: DriverUsage }
  /** Where the account's subscription quota stands (#517). */
  | { type: 'rate-limit'; limit: DriverRateLimit }
  /** The agent (or its transport) errored. */
  | { type: 'error'; message: string }
