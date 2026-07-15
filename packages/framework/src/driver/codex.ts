import { spawn as nodeSpawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { runAgentCli, type AgentCliParser, type SpawnLike } from './claude-code.js'
import type { Driver, DriverEvent, DriverPromptOptions, DriverSession, DriverStartOptions, DriverTurn } from './types.js'

/**
 * Codex's sandbox policy for the shell commands the model writes.
 * `workspace-write` is our default: the agent can edit the workspace it was
 * pointed at, but not the rest of the machine. It is the counterpart of Claude
 * Code's `acceptEdits`, and the reason we never pass Codex's
 * `--dangerously-bypass-approvals-and-sandbox`.
 */
export type CodexSandbox = 'read-only' | 'workspace-write' | 'danger-full-access'

/** Options for {@link CodexDriver}. */
export interface CodexDriverOptions {
  /** CLI binary to spawn. Default `"codex"` (resolved on `PATH`). */
  bin?: string
  /** Sandbox policy. Default `"workspace-write"`. */
  sandbox?: CodexSandbox
  /** Extra CLI args appended verbatim (escape hatch). */
  extraArgs?: string[]
  /** Environment for the child process. Default `process.env`. */
  env?: NodeJS.ProcessEnv
  /** `spawn` override for tests. Default `node:child_process.spawn`. */
  spawn?: SpawnLike
}

/**
 * The second real {@link Driver} (#539): wraps the **Codex CLI** in its
 * non-interactive mode (`codex exec --json`), on the user's own ChatGPT
 * subscription — no API key (#495's "bring your own subscription").
 *
 * The seam always said "Claude Code today, Codex later", and this is that. Same
 * black box: prompt it, let its own loop run, read the code it wrote.
 *
 * Three ways it differs from Claude Code, all of them the agent's business
 * rather than ours:
 *
 * - **No system-prompt flag.** Codex has no `--append-system-prompt`, so the
 *   framing is prepended to the prompt instead. Same words reach the agent.
 * - **No usage.** Codex reports token counts but never a price, and nothing
 *   about the subscription's remaining quota. So it omits {@link DriverTurn.usage}
 *   entirely rather than claim a run cost `$0`, which would read as free. The
 *   budget cap (#322) and the consumption limits (#519) are Claude-only until
 *   that's resolved (#540).
 * - **No quota read.** No `readQuota`, for the same reason: the seam is optional
 *   precisely so an agent that can't report one simply doesn't.
 */
export class CodexDriver implements Driver {
  readonly name = 'codex'
  constructor(private readonly opts: CodexDriverOptions = {}) {}

  start(opts: DriverStartOptions): Promise<DriverSession> {
    return Promise.resolve(new CodexSession(this.opts, opts))
  }
}

let sessionCounter = 0

/** One workspace-bound Codex session. `prompt` is a fresh CLI invocation. */
export class CodexSession implements DriverSession {
  readonly id: string
  readonly cwd: string

  constructor(
    private readonly config: CodexDriverOptions,
    private readonly startOpts: DriverStartOptions,
  ) {
    this.cwd = startOpts.cwd
    this.id = `codex-${++sessionCounter}`
  }

  prompt(text: string, opts: DriverPromptOptions = {}): Promise<DriverTurn> {
    // Codex takes no system-prompt flag, so the framing rides in front of the
    // prompt. Blank-line separated, so it reads as its own block.
    const framing = [this.startOpts.system, opts.system].filter(Boolean).join('\n\n')
    const prompt = framing ? `${framing}\n\n${text}` : text
    const emit = (event: DriverEvent) => {
      const on = this.startOpts.onEvent
      if (!on) return
      try {
        on(event)
      } catch (err) {
        console.error('[framework] codex onEvent threw; ignoring:', err)
      }
    }
    const signals = [this.startOpts.signal, opts.signal].filter((s): s is AbortSignal => s != null)
    return runAgentCli({
      bin: this.config.bin ?? 'codex',
      args: this.buildArgs(),
      cwd: this.cwd,
      env: this.config.env ?? process.env,
      prompt,
      spawn: this.config.spawn ?? (nodeSpawn as unknown as SpawnLike),
      emit,
      signals,
      parser: new CodexJsonParser(),
      agent: 'codex',
    })
  }

  async readCode(path: string): Promise<string> {
    return readFile(resolve(this.cwd, path), 'utf8')
  }

  dispose(): Promise<void> {
    // Each prompt spawns and reaps its own process; nothing durable to free.
    return Promise.resolve()
  }

  private buildArgs(): string[] {
    // No prompt argument: it goes over stdin, so a long one never hits the
    // arg-length limit. `--skip-git-repo-check` because Codex otherwise refuses
    // to run outside a git repo, and a workspace may legitimately not be one yet.
    const args = ['exec', '--json', '--skip-git-repo-check', '--sandbox', this.config.sandbox ?? 'workspace-write', '-C', this.cwd]
    if (this.startOpts.model) args.push('-m', this.startOpts.model)
    if (this.config.extraArgs) args.push(...this.config.extraArgs)
    return args
  }
}

/**
 * Parses Codex's `exec --json` output: one JSON event per line.
 *
 * The dialect, as observed on codex-cli 0.144.4:
 * ```
 * {"type":"thread.started","thread_id":"019f..."}
 * {"type":"turn.started"}
 * {"type":"item.completed","item":{"type":"agent_message","text":"..."}}
 * {"type":"item.started","item":{"type":"file_change","status":"in_progress"}}
 * {"type":"turn.completed","usage":{"input_tokens":12210,"output_tokens":5}}
 * ```
 */
export class CodexJsonParser implements AgentCliParser {
  private text = ''
  private sessionId: string | undefined

  push(line: string): DriverEvent[] {
    let obj: Record<string, unknown>
    try {
      obj = JSON.parse(line) as Record<string, unknown>
    } catch {
      return [] // Banners and other noise: not every line is an event.
    }
    const type = obj['type']

    if (type === 'thread.started') {
      const id = obj['thread_id']
      if (typeof id === 'string') this.sessionId = id
      return []
    }

    const item = obj['item']
    if (typeof item !== 'object' || item === null) return []
    const itemObj = item as Record<string, unknown>
    const itemType = itemObj['type']

    if (itemType === 'agent_message' && type === 'item.completed') {
      const text = itemObj['text']
      if (typeof text !== 'string') return []
      // Codex narrates in several messages; the last is its answer, and the
      // rest are progress. Keep the last as the turn, stream them all.
      this.text = text
      return [{ type: 'text', text }]
    }

    // Any other item is the agent using a tool. We surface the kind only, never
    // the arguments: the seam is the code and the outcome, not the tool calls.
    if (type === 'item.started' && typeof itemType === 'string') {
      return [{ type: 'action', label: itemType }]
    }
    return []
  }

  result(): DriverTurn {
    // No `usage`, deliberately: Codex reports tokens but no price, and a `$0`
    // would read as free rather than as "we don't know" (#540).
    return { text: this.text, ...(this.sessionId ? { sessionId: this.sessionId } : {}) }
  }
}
