import { randomUUID } from 'node:crypto'
import { spawn as nodeSpawn } from 'node:child_process'
import { closeSync, mkdtempSync, openSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { killTree, registerChild, unregisterChild } from './child-registry.js'
import { makeEmit } from './session-support.js'
import type { Driver, DriverEvent, DriverPromptOptions, DriverSession, DriverStartOptions, DriverTurn } from './types.js'

/**
 * A {@link Driver} that hands the task to **Claude Code on the web** (#610): it starts a
 * real cloud session on claude.ai and returns its id and URL.
 *
 * The mechanism is the CLI's own `--cloud` flag, so the account, the auth and the
 * quota are the user's, exactly as with the local driver (#495). Nothing here drives
 * the claude.ai UI: no browser, no extension, no scraping — the two earlier candidates
 * for this issue, both of which the Usage Policy rules out.
 *
 * **Why a pty.** `--cloud` refuses to run when stdout is a pipe, because a non-interactive
 * invocation would silently run locally instead. That check is about the *terminal*, not
 * about a human, so running the CLI under a pty satisfies it. `script` supplies the pty
 * (present on macOS and Linux) and the prompt travels in the environment, never inside a
 * shell string — the command string is a fixed literal, so no prompt text can reach the
 * shell as syntax.
 *
 * **What this target is, and is not.** It is a hand-off: the session runs on Anthropic's
 * infrastructure, does its own git worktree and opens its own PR, at 0% local CPU — the
 * whole point of #610. What it is not is a streamed peer like the local, device and
 * Actions targets, and that is not a shortcut in this implementation but a property of
 * the surface: a cloud session exposes **no read-back API** of any kind — no status, no
 * transcript, no output endpoint, only the session URL. So the turn resolves once the
 * session is created, and following the work happens on claude.ai, or by pulling it back
 * with `claude --teleport <id>`.
 *
 * For the same reason there is no `readCode`: the workspace lives in a cloud VM this
 * machine never sees.
 */
export class CloudDriver implements Driver {
  readonly name = 'claude-web'
  /**
   * The run ends at the hand-off (#1225). A cloud session's replies stay in the cloud, so
   * every later phase would be reading this driver's own summary of where the work went and
   * treating it as the agent's answer: the checklist found no verdict in it and reported the
   * app un-reviewable, and the backlog gate then asked the user which item to start next —
   * a question from this machine about work that is no longer on it.
   */
  readonly handsOff = true
  constructor(private readonly opts: CloudDriverOptions = {}) {}

  start(opts: DriverStartOptions): Promise<DriverSession> {
    return Promise.resolve(new CloudSession(this.opts, opts))
  }

  // No `readQuota`: a cloud session draws on the same subscription the local driver
  // already reports, and there is nothing extra to ask a session we cannot query.
}

/** Options for {@link CloudDriver}. */
export interface CloudDriverOptions {
  /** Claude Code binary. Default `"claude"`. */
  bin?: string
  /** Give up on session creation after this long, in ms. Default 120000. */
  timeoutMs?: number
  /** Run one pty-hosted invocation. Injected in tests; defaults to a real `script` pty. */
  runPty?: RunPty
  /**
   * Unique tag mixed into the session id. Default a random token. Injected in tests for a
   * stable id, and load-bearing in production for the same reason it is in the Actions
   * driver: a fresh `framework run` process restarts the counter, so without it every
   * run's first session would carry the same id.
   */
  runTag?: () => string
}

/** One pty-hosted invocation: stream its output, resolve when it ends. */
export type RunPty = (opts: RunPtyOptions) => Promise<void>

/** What {@link RunPty} needs to run one invocation. */
export interface RunPtyOptions {
  /** Claude Code binary to run under the pty. */
  bin: string
  /** The prompt, handed over through the environment rather than the command line. */
  prompt: string
  /** Model id to pass through, when one was chosen. */
  model?: string | undefined
  /** Workspace the CLI runs in — the repo whose remote the cloud session clones. */
  cwd: string
  /** Called with each chunk of terminal output. */
  onData: (chunk: string) => void
  /** Stop the invocation: the caller has what it needs, or the run was aborted. */
  signal: AbortSignal
}

/** Counter feeding the per-process half of a session id. */
let sessionCounter = 0

/** Control sequences a terminal emits around the text we actually want to read. */
const ANSI = /\x1b\[[0-9;?]*[a-zA-Z]|\x1b[()][A-Z]|\x1b[=>]|\x1b\][^\x07]*(?:\x07|\x1b\\)/g

/** The session link the CLI prints once the cloud session exists. */
const SESSION_URL = /https:\/\/claude\.ai\/code\/(session_[A-Za-z0-9]+)\S*/

/**
 * The workspace-trust question, matched with every space removed so a terminal that draws
 * the words with cursor moves rather than literal spaces still matches. The driver does not
 * answer it: trusting a workspace is the user's call to make once, in their own terminal,
 * not something a background run should decide on their behalf. It is detected only so the
 * run says what it is parked on instead of timing out with nothing to show.
 */
const TRUST_PROMPT = 'trustthisfolder'

/**
 * The project root a run worktree belongs to, which is where trust has to be granted.
 *
 * The CLI records trust per directory and everything under a trusted directory inherits it
 * (verified live: a fresh worktree of a trusted root boots straight to the REPL, a fresh
 * worktree of an untrusted root always shows the dialog). A run's cwd is an ephemeral
 * worktree — gone before the user could act on advice that names it — so the only advice
 * that works is: trust the root once, and every run worktree under it is covered.
 */
export function trustRootOf(cwd: string): string {
  const match = /^(.+?)\/\.the-framework\/worktrees\/[^/]+\/?$/.exec(cwd)
  return match ? match[1]! : cwd
}

/** The one-time fix for an untrusted workspace, phrased against the root, not the worktree. */
function trustAdvice(cwd: string): string {
  const root = trustRootOf(cwd)
  return `Run \`claude\` in ${root} once and accept the trust prompt — run worktrees inherit the root's trust — then start a new web run.`
}

/** Model ids we will pass through, kept to characters that cannot act as shell syntax. */
const SAFE_MODEL = /^[A-Za-z0-9._:-]+$/

/**
 * The rule between the task and the injected instructions in a hand-off prompt (#1497).
 * Exported so a test can pin the exact seam the claude.ai reader sees.
 */
export const CLOUD_PROMPT_SEPARATOR = '==============================='

/**
 * Assemble the one prompt a cloud session receives (#1497). Unlike every streamed driver —
 * where the system channel is invisible plumbing — this whole string is what a *human* reads
 * when they open the claude.ai session. So the task comes first (it is what the user is
 * looking for), and each injected block follows behind a hard `===` rule with a one-line
 * label, because the blocks' own markdown headers run into each other and read as one
 * confusing document without it.
 */
export function cloudHandOffPrompt(task: string, ...injected: (string | undefined)[]): string {
  const blocks = injected.filter((part): part is string => Boolean(part))
  if (blocks.length === 0) return task
  const rule = `\n\n\n${CLOUD_PROMPT_SEPARATOR}\n\n\n`
  const header = 'Instructions from The Framework, the tool that started this session:'
  return `${task}${rule}${header}\n\n${blocks.join(rule)}`
}

/**
 * One hand-off to Claude Code on the web — **exactly one, for the life of the session.**
 *
 * A run is not a single prompt. The loop prompts again for every pass (plan, build, review,
 * the TODO backlog), so a driver that started a cloud session per prompt turned one run into
 * six of them on the account. That is not a caveat, it is the wrong shape: the same task
 * handed to six independent cloud VMs is six agents racing on one repo.
 *
 * So the first prompt hands off, and every later one reports the hand-off that already
 * happened without spending another session. There is no continuation to offer either way —
 * the CLI can start a cloud session and pull one back, but it cannot send a second message
 * to one, so the honest answer to "keep going" is "this run is already over there".
 */
export class CloudSession implements DriverSession {
  readonly id: string
  readonly cwd: string
  private readonly emit: (event: DriverEvent) => void
  private readonly framing: string | undefined
  private readonly controllers = new Set<AbortController>()
  private disposed = false
  /** The cloud session this run was handed to, once it exists. Set at most once. */
  private handedOff: { url: string; sessionId: string } | undefined

  constructor(
    private readonly config: CloudDriverOptions,
    private readonly startOpts: DriverStartOptions,
  ) {
    const tag = (config.runTag ?? (() => randomUUID().slice(0, 8)))()
    this.id = `cloud-${++sessionCounter}-${tag}`
    this.cwd = startOpts.cwd
    this.emit = makeEmit(startOpts.onEvent, 'claude-web')
    this.framing = startOpts.system
  }

  async prompt(text: string, opts: DriverPromptOptions = {}): Promise<DriverTurn> {
    if (this.disposed) throw new Error('[framework] claude-web session disposed')
    // Task first, injected framing behind labeled rules (#1497): on claude.ai this string is
    // read by a human, and the task is what they open the session to find.
    const full = cloudHandOffPrompt(text, this.framing, opts.system)
    this.emit({ type: 'start', prompt: full })

    // Already handed off: say so and spend nothing. This is the guard that keeps one run to
    // one cloud session however many times the loop comes back round.
    if (this.handedOff) return this.report(this.handedOff, 'again')

    const controller = new AbortController()
    this.controllers.add(controller)
    for (const signal of [this.startOpts.signal, opts.signal]) {
      if (!signal) continue
      if (signal.aborted) {
        this.controllers.delete(controller)
        throw new Error('[framework] claude-web prompt aborted')
      }
      signal.addEventListener('abort', () => controller.abort(), { once: true })
    }

    const timeoutMs = this.config.timeoutMs ?? 120_000
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const model = this.startOpts.model
    if (model !== undefined && !SAFE_MODEL.test(model)) {
      clearTimeout(timer)
      this.controllers.delete(controller)
      throw new Error(`[framework] claude-web: unsafe model id ${JSON.stringify(model)}`)
    }

    let output = ''
    let trusting = false
    let found: { url: string; sessionId: string } | undefined
    try {
      await (this.config.runPty ?? runPtyWithScript)({
        bin: this.config.bin ?? 'claude',
        prompt: full,
        model,
        cwd: this.cwd,
        signal: controller.signal,
        onData: chunk => {
          output += chunk
          if (found) return
          const clean = output.replace(ANSI, '')
          const match = SESSION_URL.exec(clean)
          if (match) {
            found = { url: match[0], sessionId: match[1]! }
            // The link is what the dashboard needs; the CLI has nothing further to say
            // and would otherwise sit holding the terminal, so stop it here.
            controller.abort()
            return
          }
          if (!trusting && clean.replace(/\s+/g, '').includes(TRUST_PROMPT)) {
            trusting = true
            this.emit({
              type: 'notice',
              message: `Claude Code has not been trusted in ${trustRootOf(this.cwd)}, so it asks before it will start and the cloud session is never created. ${trustAdvice(this.cwd)}`,
            })
            controller.abort()
          }
        },
      })
    } finally {
      clearTimeout(timer)
      this.controllers.delete(controller)
    }

    // A user abort (Stop, the run signal) also lands here with `found` unset — the pty run
    // resolves once the controller aborts. Name it what it was, not "no cloud session was
    // created", which is the CLI-failure message.
    if (!found && (this.startOpts.signal?.aborted || opts.signal?.aborted))
      throw new Error('[framework] claude-web prompt aborted')
    // The trust dialog is a one-time, per-root fix, so fail with that instead of the raw
    // dialog text — three identical "no cloud session was created" runs in a row is what
    // this looked like before the failure named its own cure.
    if (!found && trusting)
      throw new Error(`[framework] claude-web: no cloud session was created — the workspace is not trusted by Claude Code. ${trustAdvice(this.cwd)}`)
    if (!found) throw new Error(`[framework] claude-web: no cloud session was created.\n${tail(output.replace(ANSI, ''))}`)

    this.handedOff = found
    return this.report(found, 'first')
  }

  /**
   * Report where this run went. The `first` hand-off emits the `cloud <url>` action the run
   * view links through to — mirroring the Actions driver's `run <url>` — and a later pass
   * says the work is already there, so a loop that keeps prompting cannot read the same turn
   * as fresh progress and cannot spend a second session.
   */
  private report(session: { url: string; sessionId: string }, when: 'first' | 'again'): DriverTurn {
    if (when === 'first') this.emit({ type: 'action', label: `cloud ${session.url}` })
    const summary =
      when === 'first'
        ? ['Handed off to Claude Code on the web.', '', `View the session: ${session.url}`, `Continue it here: claude --teleport ${session.sessionId}`].join('\n')
        : [
            'This run was already handed off to Claude Code on the web, so there is nothing further to do here.',
            'The work continues in that cloud session, which opens its own pull request.',
            '',
            `View the session: ${session.url}`,
            `Continue it here: claude --teleport ${session.sessionId}`,
          ].join('\n')
    // The result also carries the session's real URL (#1317): the action above is what the
    // run view links through, the result is what reaches the meta.
    this.emit({ type: 'result', text: summary, sessionId: session.sessionId, sessionLink: session.url })
    return { text: summary, sessionId: session.sessionId }
  }

  // No `readCode`: the cloud VM's workspace is not on this machine, and the branch it
  // pushes is not known until it pushes one.

  async dispose(): Promise<void> {
    this.disposed = true
    for (const controller of this.controllers) controller.abort()
    this.controllers.clear()
  }
}

/** Keep the tail of a failed invocation's output, enough to show the reason. */
function tail(text: string, max = 600): string {
  const trimmed = text.trim()
  return trimmed.length <= max ? trimmed : `...${trimmed.slice(-max)}`
}

/**
 * The shell command `script` hosts. A **fixed literal**: the prompt and the model arrive
 * as environment variables, so nothing the user typed is ever parsed as shell syntax.
 * `${FW_CLOUD_MODEL:+...}` adds the model flag only when one was chosen.
 *
 * **The prompt has to come directly after `--cloud`.** The description is that flag's own
 * value rather than a loose positional argument, so anything in between claims the slot and
 * the CLI stops with "--cloud requires a description". That is why this failed on an account
 * with a model preference and worked without one: the model flag was sitting in the slot.
 * Exported so a test can pin the order, which is load-bearing and not otherwise observable.
 */
export const CLOUD_COMMAND = 'exec "$FW_CLOUD_BIN" --cloud "$FW_CLOUD_PROMPT" ${FW_CLOUD_MODEL:+--model "$FW_CLOUD_MODEL"}'

/**
 * Run the CLI under a pty supplied by `script`, streaming its terminal output.
 *
 * `script`'s two dialects differ: BSD (macOS) takes the typescript file then the command
 * as argv, util-linux (Linux) takes `-c <command>` then the file. Both get the same fixed
 * command string, so the difference is confined to argv order.
 */
function runPtyWithScript(opts: RunPtyOptions): Promise<void> {
  return new Promise<void>((resolvePromise, rejectPromise) => {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      FW_CLOUD_BIN: opts.bin,
      FW_CLOUD_PROMPT: opts.prompt,
      ...(opts.model !== undefined ? { FW_CLOUD_MODEL: opts.model } : {}),
    }
    const args =
      process.platform === 'darwin'
        ? ['-q', '/dev/null', 'sh', '-c', CLOUD_COMMAND]
        : ['-qec', CLOUD_COMMAND, '/dev/null']
    // stdin must be a FILE. BSD `script` reads its own stdin's terminal attributes to mirror
    // them onto the pty it creates, and a pipe is a socketpair, so it dies with
    // "tcgetattr/ioctl: Operation not supported on socket" before running anything. Under a
    // daemon there is no terminal to inherit either, so the fd has to be something tcgetattr
    // can fail on harmlessly, which a regular file is.
    let dir: string
    let stdin: number
    try {
      dir = mkdtempSync(join(tmpdir(), 'framework-cloud-'))
      const path = join(dir, 'stdin')
      writeFileSync(path, '')
      stdin = openSync(path, 'r')
    } catch (err) {
      rejectPromise(new Error(`[framework] claude-web: could not prepare the pty input (${(err as Error).message})`))
      return
    }
    const cleanup = () => {
      try {
        closeSync(stdin)
        rmSync(dir, { recursive: true, force: true })
      } catch {
        // Best effort: a leftover temp file must not fail a run that otherwise worked.
      }
    }

    const child = nodeSpawn('script', args, { cwd: opts.cwd, env, detached: true, stdio: [stdin, 'pipe', 'pipe'] })
    const pid = child.pid
    if (pid != null) registerChild(pid)
    let settled = false
    const finish = (err?: Error) => {
      if (settled) return
      settled = true
      if (pid != null) {
        killTree(pid, 'SIGKILL')
        unregisterChild(pid)
      }
      cleanup()
      if (err) rejectPromise(err)
      else resolvePromise()
    }

    // Aborting is the normal ending: the caller stops us the moment the session URL lands.
    opts.signal.addEventListener('abort', () => finish(), { once: true })

    const consume = (chunk: Buffer) => opts.onData(chunk.toString('utf8'))
    child.stdout?.on('data', consume)
    child.stderr?.on('data', consume)
    child.on('error', (err: Error) =>
      finish(new Error(`[framework] claude-web: could not run the CLI under a pty (${err.message}). \`script\` must be on PATH.`)),
    )
    child.on('close', () => finish())
  })
}
