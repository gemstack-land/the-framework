import { createInterface } from 'node:readline'
import { killTree, registerChild, unregisterChild } from './child-registry.js'
import type { DriverEvent, DriverTurn } from './types.js'

// The agent-agnostic core for running one wrapped coding-agent CLI: spawn it in its own
// process group, stream its output through a parser, and gate the turn on its exit. Each
// concrete driver (claude-code, codex) supplies the argv and an AgentCliParser for its own
// output dialect; everything about the *process* lives here, so a second driver reuses it
// rather than reaching into the first driver's file for it.

/** Grace between SIGTERM and the SIGKILL that forces a hung agent tree down. */
const TERMINATE_GRACE_MS = 5000

/** The slice of `child_process.spawn` a driver needs. Injectable for tests. */
export type SpawnLike = (
  command: string,
  args: readonly string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; detached?: boolean },
) => SpawnedProcess

/** The slice of a spawned process a driver reads. */
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
