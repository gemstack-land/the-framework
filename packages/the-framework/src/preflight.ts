import { execFile } from 'node:child_process'
import { AGENT_SPECS, type AgentName } from './agent.js'

/**
 * Preflight checks for a live run. A turnkey tool should fail *early and
 * clearly* when a prerequisite is missing, not spawn a broken process mid-run.
 * The main one: is the wrapped agent's CLI actually installed and runnable?
 * `--fake` needs none of this, so preflight only gates live runs.
 *
 * It probes the agent the run actually picked (#542), so `--agent codex` is
 * checked against `codex` and fails on `codex` being missing, not `claude`.
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

function defaultProbe(bin: string): Promise<{ ok: boolean; stdout: string }> {
  return new Promise(resolvePromise => {
    execFile(bin, ['--version'], { timeout: 10_000 }, (err, stdout) => {
      resolvePromise({ ok: !err, stdout: String(stdout) })
    })
  })
}

/** Options for {@link preflight}. */
export interface PreflightOptions {
  /** The agent to check for. Default `"claude"`. */
  agent?: AgentName
  /** The CLI binary to probe. Default the agent's own. */
  bin?: string
  /** Version probe override (tests). Default runs `<bin> --version`. */
  probe?: VersionProbe
}

/**
 * Run the preflight checks: Node is implicit (we are running), and the picked
 * agent's CLI must be installed. Returns every check plus an overall `ok`.
 */
export async function preflight(opts: PreflightOptions = {}): Promise<PreflightResult> {
  const agent = opts.agent ?? 'claude'
  const spec = AGENT_SPECS[agent]
  const bin = opts.bin ?? spec.bin
  const probe = opts.probe ?? defaultProbe
  const checks: PreflightCheck[] = [{ name: 'node', ok: true, detail: process.version }]

  const cli = await probe(bin)
  checks.push(
    cli.ok
      ? { name: agent, ok: true, detail: cli.stdout.trim() || 'installed' }
      : { name: agent, ok: false, detail: `\`${bin}\` not found — ${spec.installHint}` },
  )

  return { ok: checks.every(c => c.ok), checks }
}
