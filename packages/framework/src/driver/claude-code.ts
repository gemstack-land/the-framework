import { spawn as nodeSpawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { killTree, registerChild, unregisterChild } from './child-registry.js'
import { readClaudeQuota } from './claude-code-quota.js'
import { combineFraming, combineSignals, makeEmit, readWorkspaceFile } from './session-support.js'
import type { Driver, DriverEvent, DriverPromptOptions, DriverQuota, DriverRateLimit, DriverSession, DriverStartOptions, DriverTurn, DriverUsage } from './types.js'

/** Grace between SIGTERM and the SIGKILL that forces a hung agent tree down. */
const TERMINATE_GRACE_MS = 5000

/** Claude Code permission modes we pass through to the CLI. */
export type PermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan'

/** A stdio MCP server spec, as written into the `--mcp-config` file (#452). */
export interface McpServerSpec {
  command: string
  args?: string[]
  env?: Record<string, string>
}

/** The slice of `child_process.spawn` this driver needs. Injectable for tests. */
export type SpawnLike = (
  command: string,
  args: readonly string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; detached?: boolean },
) => SpawnedProcess

/** The slice of a spawned process this driver reads. */
export interface SpawnedProcess {
  /** OS pid; present for a real child, absent for in-memory test fakes. */
  pid?: number | undefined
  stdout: NodeJS.ReadableStream | null
  stderr: NodeJS.ReadableStream | null
  stdin: NodeJS.WritableStream | null
  on(event: 'close', listener: (code: number | null) => void): unknown
  on(event: 'error', listener: (err: Error) => void): unknown
  kill(signal?: NodeJS.Signals): unknown
}

/** Options for {@link ClaudeCodeDriver}. */
export interface ClaudeCodeDriverOptions {
  /** CLI binary to spawn. Default `"claude"` (resolved on `PATH`). */
  bin?: string
  /**
   * Permission mode. Default `"acceptEdits"` so file writes are non-interactive.
   * A fully autonomous build that also runs installs / tests needs
   * `"bypassPermissions"` (or {@link dangerouslySkipPermissions}).
   */
  permissionMode?: PermissionMode
  /** Add `--dangerously-skip-permissions`. Only for sandboxes with no network. */
  dangerouslySkipPermissions?: boolean
  /** Extra CLI args appended verbatim (escape hatch). */
  extraArgs?: string[]
  /**
   * MCP servers to expose to the agent for this session (#452). Written to a
   * temp config file passed via `--mcp-config`, so they merge with the user's
   * own configured MCP servers rather than replacing them. Used by `--browser`
   * to wire chrome-devtools-mcp (a real browser + DevTools tools) into the run.
   */
  mcpServers?: Record<string, McpServerSpec>
  /** Environment for the child process. Default `process.env`. */
  env?: NodeJS.ProcessEnv
  /** `spawn` override for tests. Default `node:child_process.spawn`. */
  spawn?: SpawnLike
}

/**
 * The first real {@link Driver}: wraps the **Claude Code CLI** in print mode
 * (`claude -p --output-format stream-json`). Each {@link DriverSession.prompt}
 * spawns a fresh non-interactive invocation, so every loop pass gets fresh
 * context (option A). We stream its JSON events to {@link DriverStartOptions.onEvent}
 * for the dashboard and return the final `result` text as the turn.
 *
 * True black box: we prompt and read the result; Claude Code owns its own loop,
 * tools, and (subscription-based) auth. A second agent slots in behind the same
 * `Driver` interface without touching the orchestration above it.
 */
export class ClaudeCodeDriver implements Driver {
  readonly name = 'claude-code'
  constructor(private readonly opts: ClaudeCodeDriverOptions = {}) {}

  start(opts: DriverStartOptions): Promise<DriverSession> {
    return Promise.resolve(new ClaudeCodeSession(this.opts, opts))
  }

  /** Where the account's subscription quota stands (#521). Account-wide, so no session. */
  readQuota(opts: { signal?: AbortSignal } = {}): Promise<DriverQuota> {
    return readClaudeQuota({
      ...(this.opts.bin !== undefined ? { bin: this.opts.bin } : {}),
      ...(this.opts.env !== undefined ? { env: this.opts.env } : {}),
      ...(this.opts.spawn !== undefined ? { spawn: this.opts.spawn } : {}),
      ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
    })
  }
}

let sessionCounter = 0

/** One workspace-bound Claude Code session. `prompt` is a fresh CLI invocation. */
export class ClaudeCodeSession implements DriverSession {
  readonly id: string
  readonly cwd: string
  /** Path to the written `--mcp-config` file, lazily created on first use. */
  private mcpConfigPath: string | undefined

  constructor(
    private readonly config: ClaudeCodeDriverOptions,
    private readonly startOpts: DriverStartOptions,
  ) {
    this.cwd = startOpts.cwd
    this.id = `claude-code-${++sessionCounter}`
  }

  prompt(text: string, opts: DriverPromptOptions = {}): Promise<DriverTurn> {
    const system = combineFraming(this.startOpts.system, opts.system)
    return runClaude({
      bin: this.config.bin ?? 'claude',
      args: this.buildArgs(system),
      cwd: this.cwd,
      env: this.config.env ?? process.env,
      prompt: text,
      spawn: this.config.spawn ?? (nodeSpawn as unknown as SpawnLike),
      emit: makeEmit(this.startOpts.onEvent, 'claude-code'),
      signals: combineSignals(this.startOpts.signal, opts.signal),
    })
  }

  readCode(path: string): Promise<string> {
    return readWorkspaceFile(this.cwd, path)
  }

  dispose(): Promise<void> {
    // Each prompt spawns and reaps its own process, so the only durable thing is
    // the temp MCP config file; drop it. The session id reaches the UI via the
    // emitted result event.
    if (this.mcpConfigPath) {
      try {
        rmSync(dirname(this.mcpConfigPath), { recursive: true, force: true })
      } catch {
        // Best effort: the temp dir lands under the OS tmp and is reaped anyway.
      }
      this.mcpConfigPath = undefined
    }
    return Promise.resolve()
  }

  private buildArgs(system: string): string[] {
    const args = ['-p', '--output-format', 'stream-json', '--verbose']
    if (this.config.dangerouslySkipPermissions) args.push('--dangerously-skip-permissions')
    else args.push('--permission-mode', this.config.permissionMode ?? 'acceptEdits')
    if (system) args.push('--append-system-prompt', system)
    if (this.startOpts.model) args.push('--model', this.startOpts.model)
    const mcpConfig = this.mcpConfigFile()
    if (mcpConfig) args.push('--mcp-config', mcpConfig)
    if (this.config.extraArgs) args.push(...this.config.extraArgs)
    return args
  }

  /**
   * Lazily materialize the `--mcp-config` file for {@link ClaudeCodeDriverOptions.mcpServers}.
   * Written once and reused across the session's prompts; `undefined` when no
   * servers are configured. Not `--strict-mcp-config`, so these merge with the
   * user's own MCP servers rather than replacing them.
   */
  private mcpConfigFile(): string | undefined {
    const servers = this.config.mcpServers
    if (!servers || Object.keys(servers).length === 0) return undefined
    if (!this.mcpConfigPath) {
      const dir = mkdtempSync(join(tmpdir(), 'framework-mcp-'))
      this.mcpConfigPath = join(dir, 'mcp.json')
      writeFileSync(this.mcpConfigPath, JSON.stringify({ mcpServers: servers }))
    }
    return this.mcpConfigPath
  }
}

/**
 * The slice of a driver's output parser {@link runAgentCli} drives: fed one line
 * at a time, asked for the turn at the end. Each wrapped agent speaks its own
 * dialect ({@link StreamJsonParser} for Claude Code, `CodexJsonParser` for
 * Codex), but the process handling around it is identical.
 */
export interface AgentCliParser {
  /** Fold one line of the agent's output in, and surface anything worth emitting. */
  push(line: string): DriverEvent[]
  /** The turn the lines added up to. */
  result(): DriverTurn
}

/** How to run one agent-CLI invocation. */
export interface RunAgentCliOptions {
  bin: string
  args: string[]
  cwd: string
  env: NodeJS.ProcessEnv
  prompt: string
  spawn: SpawnLike
  emit: (event: DriverEvent) => void
  signals: AbortSignal[]
  /** The agent's own output dialect. */
  parser: AgentCliParser
  /** The agent's name, for error messages. Default `"claude-code"`. */
  agent?: string
}

/** @deprecated Use {@link RunAgentCliOptions}. */
export type RunClaudeOptions = Omit<RunAgentCliOptions, 'parser' | 'agent'>

/** Spawn one Claude Code invocation and resolve with its final turn. */
export function runClaude(opts: RunClaudeOptions): Promise<DriverTurn> {
  return runAgentCli({ ...opts, parser: new StreamJsonParser() })
}

/**
 * Spawn one agent-CLI invocation and resolve with its final turn.
 *
 * Everything here is about the *process*, not the agent: its own process group
 * so an interrupt kills the whole tree rather than orphaning it, a SIGTERM/
 * SIGKILL grace window, abort wiring, and a non-zero exit failing the turn even
 * when text was streamed first. Only {@link RunAgentCliOptions.parser} knows
 * which agent is on the other end — a second agent gets all of this for free
 * rather than a second copy of it.
 */
export function runAgentCli(opts: RunAgentCliOptions): Promise<DriverTurn> {
  return new Promise<DriverTurn>((resolvePromise, rejectPromise) => {
    for (const s of opts.signals) {
      if (s.aborted) {
        rejectPromise(new Error(`[framework] ${opts.agent ?? 'claude-code'} prompt aborted`))
        return
      }
    }

    opts.emit({ type: 'start', prompt: opts.prompt })
    // `detached` makes the child its own process-group leader so we can kill the
    // whole agent subtree (claude + node workers + tool calls) at once, not just
    // the top process — otherwise an interrupt orphans the tree (the leak).
    const child = opts.spawn(opts.bin, opts.args, { cwd: opts.cwd, env: opts.env, detached: true })
    const pid = child.pid
    if (pid != null) registerChild(pid)
    const parser = opts.parser
    const agent = opts.agent ?? 'claude-code'
    let settled = false
    let hardKillTimer: ReturnType<typeof setTimeout> | undefined
    const stderrChunks: string[] = []

    // Kill the agent's whole process group: SIGTERM to let it flush, then a
    // SIGKILL after a grace window in case it ignores the term (mid tool-call).
    const terminate = () => {
      if (pid != null) killTree(pid, 'SIGTERM')
      else child.kill('SIGTERM')
      hardKillTimer = setTimeout(() => {
        if (pid != null) killTree(pid, 'SIGKILL')
        else child.kill('SIGKILL')
      }, TERMINATE_GRACE_MS)
      hardKillTimer.unref?.()
    }

    // Runs exactly once the process is done with (closed, errored, or killed):
    // stop tracking it and cancel any pending hard-kill.
    const cleanup = () => {
      if (pid != null) unregisterChild(pid)
      if (hardKillTimer) clearTimeout(hardKillTimer)
    }

    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      for (const { signal, handler } of aborts) signal.removeEventListener('abort', handler)
      fn()
    }

    const aborts = opts.signals.map(signal => {
      const handler = () => {
        if (settled) return
        terminate()
        finish(() => rejectPromise(new Error(`[framework] ${agent} prompt aborted`)))
      }
      signal.addEventListener('abort', handler)
      return { signal, handler }
    })

    child.on('error', err => {
      cleanup()
      finish(() => rejectPromise(err))
    })

    if (child.stdout) {
      const rl = createInterface({ input: child.stdout })
      rl.on('line', line => {
        for (const event of parser.push(line)) opts.emit(event)
      })
    }
    if (child.stderr) {
      child.stderr.on('data', (chunk: Buffer | string) => stderrChunks.push(String(chunk)))
    }

    child.on('close', code => {
      cleanup()
      const turn = parser.result()
      // A non-zero exit is a failed turn even when the agent streamed some text
      // first: the loop gates on the outcome, so a crash mid-build must not pass
      // as a result. Surface stderr, else the partial text, as context.
      if (code !== 0) {
        const detail = stderrChunks.join('').trim() || turn.text.trim() || `exit code ${code ?? 'null'}`
        opts.emit({ type: 'error', message: detail })
        finish(() => rejectPromise(new Error(`[framework] ${agent} exited (${code ?? 'null'}): ${detail}`)))
        return
      }
      opts.emit({
        type: 'result',
        text: turn.text,
        ...(turn.sessionId ? { sessionId: turn.sessionId } : {}),
        ...(turn.usage ? { usage: turn.usage } : {}),
      })
      finish(() => resolvePromise(turn))
    })

    // Feed the prompt over stdin so long prompts never hit arg-length limits.
    if (child.stdin) {
      child.stdin.write(opts.prompt)
      child.stdin.end()
    }
  })
}

/**
 * Incremental parser for Claude Code's `stream-json` output: newline-delimited
 * JSON, one object per line. We surface assistant text + tool names as
 * {@link DriverEvent}s and keep the final `result` line as the turn text.
 * Kept separate from the process plumbing so it is unit-testable in isolation.
 */
export class StreamJsonParser {
  private finalText = ''
  private assistantText = ''
  private sessionId?: string
  private usage?: DriverUsage

  /** Feed one line; returns the events it produced (may be empty). */
  push(line: string): DriverEvent[] {
    const trimmed = line.trim()
    if (!trimmed) return []
    let obj: Record<string, unknown>
    try {
      obj = JSON.parse(trimmed) as Record<string, unknown>
    } catch {
      return [] // Non-JSON noise (banners etc.); ignore.
    }

    if (typeof obj['session_id'] === 'string') this.sessionId = obj['session_id']
    const type = obj['type']

    if (type === 'assistant') return this.handleAssistant(obj)
    if (type === 'rate_limit_event') {
      const limit = parseRateLimit(obj)
      return limit ? [{ type: 'rate-limit', limit }] : []
    }
    if (type === 'result') {
      const result = obj['result']
      if (typeof result === 'string') this.finalText = result
      const usage = parseUsage(obj)
      if (usage) this.usage = usage
      return [] // The `result` event is emitted by the runner after `close`.
    }
    return []
  }

  private handleAssistant(obj: Record<string, unknown>): DriverEvent[] {
    const message = obj['message']
    if (typeof message !== 'object' || message === null) return []
    const content = (message as Record<string, unknown>)['content']
    if (!Array.isArray(content)) return []
    const events: DriverEvent[] = []
    for (const item of content) {
      if (typeof item !== 'object' || item === null) continue
      const block = item as Record<string, unknown>
      if (block['type'] === 'text' && typeof block['text'] === 'string') {
        this.assistantText += block['text']
        events.push({ type: 'text', text: block['text'] })
      } else if (block['type'] === 'tool_use' && typeof block['name'] === 'string') {
        events.push({ type: 'action', label: block['name'] })
      }
    }
    return events
  }

  /** The final turn: the `result` text, falling back to accumulated assistant text. */
  result(): DriverTurn {
    const text = this.finalText || this.assistantText
    return {
      text,
      ...(this.sessionId ? { sessionId: this.sessionId } : {}),
      ...(this.usage ? { usage: this.usage } : {}),
    }
  }
}

/**
 * Pull the account's quota standing off a `rate_limit_event` line (#517):
 * `{status, resetsAt, rateLimitType}`. The agent emits one per turn, so this is
 * free telemetry — no extra call, no polling. Returns undefined when the payload
 * is missing the parts we'd gate on, so a malformed line stays silent rather
 * than reporting a bogus reset.
 */
function parseRateLimit(obj: Record<string, unknown>): DriverRateLimit | undefined {
  const raw = obj['rate_limit_info']
  if (typeof raw !== 'object' || raw === null) return undefined
  const info = raw as Record<string, unknown>
  const status = info['status']
  const window = info['rateLimitType']
  const resetsAt = info['resetsAt']
  if (typeof status !== 'string' || typeof window !== 'string') return undefined
  if (typeof resetsAt !== 'number' || !Number.isFinite(resetsAt)) return undefined
  // The agent reports epoch seconds; the rest of the framework speaks millis.
  return { status, window, resetsAt: resetsAt * 1000 }
}

/**
 * Pull token + cost accounting off Claude Code's `result` line (#322):
 * `total_cost_usd` plus a `usage` object of token counts. Returns undefined when
 * the line carries neither, so a driver/agent that omits usage stays usage-free.
 */
function parseUsage(obj: Record<string, unknown>): DriverUsage | undefined {
  const cost = obj['total_cost_usd']
  const raw = obj['usage']
  const hasUsage = typeof raw === 'object' && raw !== null
  if (typeof cost !== 'number' && !hasUsage) return undefined
  const usage = (hasUsage ? raw : {}) as Record<string, unknown>
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
  return {
    costUsd: typeof cost === 'number' && Number.isFinite(cost) ? cost : 0,
    inputTokens: num(usage['input_tokens']),
    outputTokens: num(usage['output_tokens']),
    cacheReadTokens: num(usage['cache_read_input_tokens']),
    cacheCreationTokens: num(usage['cache_creation_input_tokens']),
  }
}
