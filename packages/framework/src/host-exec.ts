import { exec as cpExec } from 'node:child_process'
import { isAbsolute, join } from 'node:path'
import type { DeployExecutor, ExecOptions, ExecResult } from '@gemstack/ai-autopilot'

/** Options for {@link hostExecutor}. */
export interface HostExecutorOptions {
  /** Base environment for every command. Default `process.env`. */
  env?: NodeJS.ProcessEnv
  /** Max stdout/stderr bytes to buffer per command. Default 16 MiB. */
  maxBuffer?: number
}

/**
 * A {@link DeployExecutor} that runs shell commands on the host, in the
 * workspace the wrapped agent built (its `cwd`). This is what lets a real deploy
 * target (e.g. `cloudflareTarget`) install / build / run `wrangler` against the
 * code Claude Code just wrote, since the runner seam's `LocalRunner` cannot: it
 * mkdtemps a fresh workspace and deletes it on dispose.
 *
 * Never rejects: a non-zero exit or a spawn error resolves to an {@link ExecResult}
 * with the exit code and captured output, matching the runner-session contract
 * the deploy targets expect.
 */
export function hostExecutor(cwd: string, opts: HostExecutorOptions = {}): DeployExecutor {
  const baseEnv = opts.env ?? process.env
  const maxBuffer = opts.maxBuffer ?? 16 * 1024 * 1024
  return {
    exec(command: string, execOpts: ExecOptions = {}): Promise<ExecResult> {
      const dir = execOpts.cwd ? (isAbsolute(execOpts.cwd) ? execOpts.cwd : join(cwd, execOpts.cwd)) : cwd
      const env = execOpts.env ? { ...baseEnv, ...execOpts.env } : baseEnv
      return new Promise<ExecResult>(resolvePromise => {
        cpExec(
          command,
          { cwd: dir, env, timeout: execOpts.timeoutMs ?? 0, maxBuffer },
          (err, stdout, stderr) => {
            const exitCode = err ? (typeof err.code === 'number' ? err.code : 1) : 0
            resolvePromise({ stdout: String(stdout), stderr: String(stderr), exitCode })
          },
        )
      })
    },
  }
}
