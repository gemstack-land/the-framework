/**
 * One `execFile`-backed CLI runner, configured per binary.
 *
 * `git` and `gh` were each wrapped by hand — the same dynamic import, the same promise
 * around `execFile`, the same `String(stdout)` — differing only in the binary, the timeout
 * and how a failure is reported. Those are the parameters; the wrapper is not worth writing
 * twice, and it was written five times.
 */

/** Runs a CLI binary in `cwd`, resolving its stdout. Rejects on a non-zero exit. */
export type CliRunner = (args: string[], cwd: string) => Promise<string>

/**
 * How long one invocation may run: a flat budget, or one derived from the args (#997).
 *
 * One binary is not one operation. `git push` talks to a remote and `git worktree add` writes a
 * whole checkout, while `git rev-parse` reads a file; a single number has to be either too short
 * for the first two or too long for the third.
 */
export type CliTimeout = number | ((args: string[]) => number)

/**
 * A CLI killed for outrunning its timeout, as opposed to one the tool itself rejected (#997).
 *
 * `execFile` SIGTERMs on timeout, and a killed `git push` usually writes nothing to stderr, so
 * without this the failure surfaces as a bare "Command failed: git push ..." that reads like a
 * rejected push.
 */
export class CliTimeoutError extends Error {
  /** Brand, so a value that crossed a module boundary is still recognisable. */
  readonly timedOut = true
  constructor(
    readonly bin: string,
    readonly args: string[],
    readonly timeoutMs: number,
  ) {
    super(`${bin} ${args.join(' ')} timed out after ${timeoutMs}ms`)
    this.name = 'CliTimeoutError'
  }
}

/** True when a {@link CliRunner} rejection is a timeout kill rather than a non-zero exit (#997). */
export function isCliTimeout(err: unknown): err is CliTimeoutError {
  return err instanceof Error && (err as { timedOut?: unknown }).timedOut === true
}

/** How to invoke one binary. */
export interface CliRunnerOptions {
  bin: string
  /** Kill the process after this long, so a hung CLI cannot hang the caller. */
  timeoutMs: CliTimeout
  /** Raise the stdout cap for a command whose output can be large (a repo crawl). */
  maxBuffer?: number
  /**
   * Reject with the CLI's own stderr rather than the generic exec message. `gh` puts the
   * useful part there ("not logged in", "no default remote"), and that is exactly what the
   * dashboard should show instead of a generic failure.
   */
  preferStderr?: boolean
}

/** Build a {@link CliRunner} for one binary. */
export function cliRunner(opts: CliRunnerOptions): CliRunner {
  return async (args, cwd) => {
    const { execFile } = await import('node:child_process')
    const timeoutMs = typeof opts.timeoutMs === 'function' ? opts.timeoutMs(args) : opts.timeoutMs
    return new Promise<string>((resolvePromise, rejectPromise) => {
      execFile(
        opts.bin,
        args,
        { cwd, timeout: timeoutMs, ...(opts.maxBuffer !== undefined ? { maxBuffer: opts.maxBuffer } : {}) },
        (err, stdout, stderr) => {
          if (!err) return resolvePromise(String(stdout))
          // execFile kills on both timeout and a maxBuffer overrun; only the latter carries ENOBUFS.
          const killed = (err as { killed?: boolean }).killed === true
          if (killed && (err as { code?: unknown }).code !== 'ENOBUFS') {
            return rejectPromise(new CliTimeoutError(opts.bin, args, timeoutMs))
          }
          rejectPromise(opts.preferStderr ? new Error(String(stderr).trim() || err.message) : err)
        },
      )
    })
  }
}
