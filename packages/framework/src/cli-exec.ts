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

/** How to invoke one binary. */
export interface CliRunnerOptions {
  bin: string
  /** Kill the process after this long, so a hung CLI cannot hang the caller. */
  timeoutMs: number
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
    return new Promise<string>((resolvePromise, rejectPromise) => {
      execFile(
        opts.bin,
        args,
        { cwd, timeout: opts.timeoutMs, ...(opts.maxBuffer !== undefined ? { maxBuffer: opts.maxBuffer } : {}) },
        (err, stdout, stderr) => {
          if (!err) return resolvePromise(String(stdout))
          rejectPromise(opts.preferStderr ? new Error(String(stderr).trim() || err.message) : err)
        },
      )
    })
  }
}
