import { execFile } from 'node:child_process'

/**
 * Preflight checks for a live run. A turnkey tool should fail *early and
 * clearly* when a prerequisite is missing, not spawn a broken process mid-run.
 * The main one: is the wrapped agent's CLI (Claude Code) actually installed and
 * runnable? `--fake` needs none of this, so preflight only gates live runs.
 */

/** One preflight check's outcome. */
export interface PreflightCheck {
  name: string
  ok: boolean
  /** Human-readable detail: the version when ok, or how to fix it when not. */
  detail: string
}

/** The result of running all preflight checks. */
export interface PreflightResult {
  ok: boolean
  checks: PreflightCheck[]
}

/** Probe a binary for a version string. Injectable so tests need no real CLI. */
export type VersionProbe = (bin: string) => Promise<{ ok: boolean; stdout: string }>

const CLAUDE_INSTALL_HINT = 'install Claude Code and make sure `claude` is on your PATH: https://claude.com/claude-code'

function defaultProbe(bin: string): Promise<{ ok: boolean; stdout: string }> {
  return new Promise(resolvePromise => {
    execFile(bin, ['--version'], { timeout: 10_000 }, (err, stdout) => {
      resolvePromise({ ok: !err, stdout: String(stdout) })
    })
  })
}

/** Options for {@link preflight}. */
export interface PreflightOptions {
  /** The agent CLI binary to probe. Default `"claude"`. */
  bin?: string
  /** Version probe override (tests). Default runs `<bin> --version`. */
  probe?: VersionProbe
}

/**
 * Run the preflight checks: Node is implicit (we are running), and the wrapped
 * agent CLI must be installed. Returns every check plus an overall `ok`.
 */
export async function preflight(opts: PreflightOptions = {}): Promise<PreflightResult> {
  const bin = opts.bin ?? 'claude'
  const probe = opts.probe ?? defaultProbe
  const checks: PreflightCheck[] = [{ name: 'node', ok: true, detail: process.version }]

  const cc = await probe(bin)
  checks.push(
    cc.ok
      ? { name: 'claude-code', ok: true, detail: cc.stdout.trim() || 'installed' }
      : { name: 'claude-code', ok: false, detail: `\`${bin}\` not found — ${CLAUDE_INSTALL_HINT}` },
  )

  return { ok: checks.every(c => c.ok), checks }
}
