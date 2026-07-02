import type { RunnerSession } from '../runner/types.js'
import type { Verdict } from '../loop/verdict.js'
import type { BootstrapSteps, LoopPassContext } from './types.js'

/**
 * A production-grade check with teeth: instead of only *asking* whether the app
 * is production-grade (the prompt-based {@link loopChecklist}), this one actually
 * BOOTS it and confirms it serves. It runs inside the same runner session the
 * build wrote into — install deps, optionally build, `start` the dev server,
 * `preview` until the port is reachable, then fetch a health path — and turns any
 * failure into a concrete `{ blockers }` verdict the full-fledged loop addresses.
 *
 * It satisfies the `checklist` step contract, so wire it directly
 * (`checklist: serveCheck(session, { serve: 'npm run dev' })`) or, more usefully,
 * compose it with the prompt checklist via {@link mergeChecklists} so a pass must
 * BOTH read production-grade AND actually run.
 *
 * Needs a runner that can `start` background processes and `preview` them (the
 * #137 seam). A runner without those capabilities can't verify, so the check is
 * skipped (a passing verdict with a note) rather than blocking forever.
 */
export interface ServeCheckOptions {
  /** The command that starts the dev server (e.g. `npm run dev`). Required. */
  serve: string
  /** Install command run first (e.g. `npm install`). Skipped when omitted. */
  install?: string
  /** Build command run after install (e.g. `npm run build`). Skipped when omitted. */
  build?: string
  /** The port the dev server listens on. Default 3000. */
  port?: number
  /** How long to wait for the server to accept connections. Default 15000ms. */
  waitMs?: number
  /** Path to fetch once the server is up. Default `/`. */
  healthPath?: string
  /** A response status at or above this is a blocker (the app errored). Default 500. */
  errorStatusFrom?: number
  /** Per-command timeout for install/build. Default 120000ms. */
  commandTimeoutMs?: number
  /** Optional progress narration (install / start / fetch). */
  onProgress?: (message: string) => void
}

/**
 * Build a `checklist` step that verifies the app boots and serves in `session`.
 * Returns a {@link Verdict}: empty `blockers` means it installed, started, and
 * responded without a server error; otherwise each blocker names what failed.
 */
export function serveCheck(session: RunnerSession, opts: ServeCheckOptions): NonNullable<BootstrapSteps['checklist']> {
  const port = opts.port ?? 3000
  const waitMs = opts.waitMs ?? 15_000
  const healthPath = opts.healthPath ?? '/'
  const errorFrom = opts.errorStatusFrom ?? 500
  const commandTimeoutMs = opts.commandTimeoutMs ?? 120_000
  const say = (m: string): void => opts.onProgress?.(m)

  return async (_ctx: LoopPassContext): Promise<Verdict> => {
    if (!session.start || !session.preview) {
      return { blockers: [], notes: 'serve check skipped: runner cannot start/preview a dev server' }
    }

    // Install / build are prerequisites — if they fail, there is nothing to serve.
    for (const [label, command] of [['install', opts.install], ['build', opts.build]] as const) {
      if (!command) continue
      say(`${label}: ${command}`)
      const res = await session.exec(command, { timeoutMs: commandTimeoutMs })
      if (res.exitCode !== 0) {
        const tail = (res.stderr || res.stdout).trim().split('\n').slice(-3).join(' ').slice(0, 300)
        return { blockers: [`${label} failed (\`${command}\` exited ${res.exitCode})${tail ? `: ${tail}` : ''}`] }
      }
    }

    say(`start: ${opts.serve}`)
    const proc = await session.start(opts.serve)
    try {
      const { url } = await session.preview({ port, waitMs })
      const target = new URL(healthPath, url.endsWith('/') ? url : url + '/').toString()

      // If the server crashed on boot, its process has already exited — say so.
      const raced = await Promise.race([
        fetch(target).then(res => ({ ok: true as const, status: res.status }), err => ({ ok: false as const, error: err as Error })),
        proc.exit.then(r => ({ ok: false as const, exited: r.exitCode, log: (r.stderr || r.stdout).trim().split('\n').slice(-3).join(' ').slice(0, 300) })),
      ])

      if ('exited' in raced) {
        return { blockers: [`the dev server (\`${opts.serve}\`) exited before serving (code ${raced.exited})${raced.log ? `: ${raced.log}` : ''}`] }
      }
      if (!raced.ok) {
        return { blockers: [`the app did not serve at ${target}: ${raced.error.message}`] }
      }
      say(`fetch ${target} -> ${raced.status}`)
      if (raced.status >= errorFrom) {
        return { blockers: [`the app responded ${raced.status} at ${healthPath} (expected < ${errorFrom})`] }
      }
      return { blockers: [] }
    } finally {
      await proc.stop()
    }
  }
}

/**
 * Compose several `checklist` steps into one: run them all and union their
 * blockers (deduped). Use it to gate a pass on BOTH the prompt verdict and a real
 * serve check — `mergeChecklists(loopChecklist({ loop }), serveCheck(session, ...))`.
 * A pass is production-grade only when every check comes back clean.
 */
export function mergeChecklists(
  ...checks: ReadonlyArray<NonNullable<BootstrapSteps['checklist']>>
): NonNullable<BootstrapSteps['checklist']> {
  return async (ctx: LoopPassContext): Promise<Verdict> => {
    const verdicts = await Promise.all(checks.map(check => check(ctx)))
    const blockers = [...new Set(verdicts.flatMap(v => v.blockers))]
    const notes = verdicts.map(v => v.notes).filter(Boolean).join(' | ')
    return { blockers, ...(notes ? { notes } : {}) }
  }
}
