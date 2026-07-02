/**
 * The pluggable execution seam. A `Runner` boots isolated workspaces where
 * autopilot writes project files, runs commands, and (optionally) serves a live
 * preview. It is modeled on Flue's `sandbox` contract so a real sandbox drops in
 * behind one interface — this is the "sit on harnesses, don't compete" bet made
 * concrete: WebContainer (instant in-browser Vike preview), a Docker sandbox on
 * our servers, or a Flue sandbox (in-memory / edge / container) are all just
 * implementations of `Runner`.
 *
 * This module is the interface + a `FakeRunner`; the real implementations land
 * behind it as separate adapters.
 */

/** A set of files to seed a workspace with: path (relative) → contents. */
export type FileTree = Record<string, string>

/** Options for provisioning a fresh workspace. */
export interface BootOptions {
  /** Files written into the workspace before any command runs. */
  files?: FileTree
  /** Default working directory for `exec`; defaults to the workspace root. */
  cwd?: string
  /** Environment variables available to every `exec` in the session. */
  env?: Record<string, string>
}

/** Per-command overrides for {@link RunnerSession.exec}. */
export interface ExecOptions {
  /** Working directory, relative to the workspace root. */
  cwd?: string
  /** Extra environment variables, merged over the session env. */
  env?: Record<string, string>
  /** Abort the command after this many milliseconds. */
  timeoutMs?: number
}

/** The outcome of running a command. */
export interface ExecResult {
  stdout: string
  stderr: string
  /** Process exit code; `0` is success. */
  exitCode: number
}

/**
 * A handle to a long-running process started with {@link RunnerSession.start} —
 * a dev server, a watcher, anything that does not exit on its own. Unlike `exec`
 * (which resolves when the command finishes), `start` returns immediately with
 * this handle so the caller can serve a {@link RunnerSession.preview} against it.
 */
export interface RunnerProcess {
  /** The command that was started. */
  readonly command: string
  /** Resolves when the process exits — on its own, or after {@link stop}. */
  readonly exit: Promise<ExecResult>
  /** Stop the process. Idempotent; resolves once it has exited. */
  stop(): Promise<void>
}

/** A virtual filesystem scoped to a single session's workspace. */
export interface RunnerFs {
  read(path: string): Promise<string>
  write(path: string, contents: string): Promise<void>
  remove(path: string): Promise<void>
  /** List entries under `dir` (workspace root when omitted). */
  list(dir?: string): Promise<string[]>
  exists(path: string): Promise<boolean>
}

/** Options for exposing a running dev server. */
export interface PreviewOptions {
  /** Port the server listens on inside the sandbox. */
  port?: number
  /**
   * Wait up to this many milliseconds for the port to accept connections before
   * returning, so the URL is reachable the moment `preview` resolves. Default `0`
   * (return immediately — a runner that can't probe readiness ignores it).
   */
  waitMs?: number
}

/** A reachable URL for the running app. */
export interface Preview {
  url: string
  port: number
}

/**
 * One booted workspace: a virtual filesystem, a shell, and an optional preview.
 *
 * `preview` is optional by design — not every runner serves HTTP (a one-shot CI
 * sandbox may only `exec`). Its presence *is* the capability signal: callers
 * (and {@link runnerTools}) branch on whether `session.preview` is defined.
 */
export interface RunnerSession {
  /** Stable id for this workspace. */
  readonly id: string
  readonly fs: RunnerFs
  exec(command: string, opts?: ExecOptions): Promise<ExecResult>
  /**
   * Start a long-running command (a dev server) in the background and return a
   * handle to it, without waiting for it to exit. Absent when the runner only
   * supports one-shot `exec` — presence is the capability signal, like `preview`.
   */
  start?(command: string, opts?: ExecOptions): Promise<RunnerProcess>
  /** Expose a running dev server and return its URL. Absent when unsupported. */
  preview?(opts?: PreviewOptions): Promise<Preview>
  /** Tear down the workspace and release its resources. Idempotent. */
  dispose(): Promise<void>
}

/**
 * A pluggable execution environment. `boot()` provisions a fresh, isolated
 * workspace and returns a {@link RunnerSession}.
 */
export interface Runner {
  /** Identifies the implementation: `fake`, `flue`, `webcontainer`, `docker`, … */
  readonly kind: string
  boot(opts?: BootOptions): Promise<RunnerSession>
}

/** Thrown for runner misuse (unsupported operation, disposed session, …). */
export class RunnerError extends Error {
  constructor(message: string) {
    super(`[ai-autopilot] ${message}`)
    this.name = 'RunnerError'
  }
}
