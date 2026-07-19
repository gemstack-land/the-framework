import type { ConsumptionStatus, LimitStatus } from './consumption.js'

/**
 * Auto PM (#685): spend leftover subscription quota on product management instead of
 * letting it expire. When the agent queue is empty and there is plenty of budget left,
 * the daemon starts a PM run by itself — spiking and planning the tickets that have
 * neither yet — so the backlog refills while nobody is at the keyboard.
 *
 * The whole feature is one policy question ("is now a good time to spend tokens on our
 * own roadmap?"), so that question lives here as a pure function and the daemon only
 * supplies the readings. #298 is the parent idea (background jobs / "max out the usage"),
 * and #519 already built the meter this reads.
 */

/** How much of every enabled budget must still be free before a run starts unasked. */
export const DEFAULT_MIN_FREE_PERCENT = 50

/** How often the daemon re-asks {@link autoPmDecision}. */
export const DEFAULT_AUTO_PM_INTERVAL_MS = 10 * 60 * 1000

/**
 * How long a project is left alone after an auto run is started for it. A spawned run
 * takes a moment to appear in the daemon's live-run map, and without this the next tick
 * would see "nothing running, queue still empty" and start a second one.
 */
export const DEFAULT_AUTO_PM_COOLDOWN_MS = 30 * 60 * 1000

/** What the policy was told about one project at one moment. */
export interface AutoPmInputs {
  /** The `autoPm` preference. Off = the feature does nothing at all. */
  enabled: boolean
  /** Whether the project's agent queue (`TODO_AGENTS.md`) has no open entry left. */
  backlogEmpty: boolean
  /** Live runs on this project. Any run at all means the user's quota is already being spent. */
  activeRuns: number
  /** Where the consumption limits stand, or `undefined` when the quota could not be read. */
  quota: ConsumptionStatus | undefined
  /** Milliseconds since this project was last auto-started, or `undefined` if it never was. */
  sinceLastStartMs?: number
  /** Override {@link DEFAULT_MIN_FREE_PERCENT}. */
  minFreePercent?: number
  /** Override {@link DEFAULT_AUTO_PM_COOLDOWN_MS}. */
  cooldownMs?: number
}

/** Start, or the reason not to. The reason is logged, so it reads as a sentence. */
export type AutoPmDecision = { start: true } | { start: false; reason: string }

/**
 * Whether there is enough headroom to spend unasked, across the windows that recover
 * slowly enough to matter (the day and the rolling 5h). The session window is ignored:
 * this only ever runs when nothing is running, so there is no session to measure.
 *
 * **This gate fails closed, and that is the opposite of the per-run guard.** #519 settled
 * that an unreadable quota must never *stop* the user's own work, so `startConsumptionGuard`
 * fails open. Work nobody asked for is the other way round: if we cannot see the meter we
 * cannot promise we are spending a surplus, and quietly burning a subscription is a far worse
 * failure than skipping a tick. So no reading means no run, and a disabled limit means we
 * have no denominator to call anything "spare".
 */
export function quotaHeadroom(quota: ConsumptionStatus | undefined, minFreePercent: number): AutoPmDecision {
  if (!quota) return { start: false, reason: 'the quota could not be read, so there is no way to tell what is spare' }
  const windows: [string, LimitStatus][] = [
    ['the daily budget', quota.daily],
    ['the 5h budget', quota.fiveHour],
  ]
  const enabled = windows.filter(([, limit]) => limit.enabled)
  if (!enabled.length) {
    return { start: false, reason: 'no consumption limit is enabled, so there is no budget to spend a share of' }
  }
  for (const [label, limit] of enabled) {
    if (limit.usedPercent === undefined) {
      return { start: false, reason: `${label} has no reading yet` }
    }
    if (limit.usedPercent > 100 - minFreePercent) {
      return { start: false, reason: `${label} is ${Math.round(limit.usedPercent)}% used` }
    }
  }
  return { start: true }
}

/**
 * Whether to start a PM run for one project right now. Every condition is a reason to
 * *not* spend the user's quota, checked cheapest first so the common "someone is working"
 * case never reaches the meter.
 */
export function autoPmDecision(input: AutoPmInputs): AutoPmDecision {
  if (!input.enabled) return { start: false, reason: 'auto PM is off' }
  if (input.activeRuns > 0) {
    return { start: false, reason: `${input.activeRuns} run${input.activeRuns === 1 ? ' is' : 's are'} already going` }
  }
  // A non-empty queue is not idleness: the backlog loop has work to drain, and #685 is
  // about the case where it has run dry.
  if (!input.backlogEmpty) return { start: false, reason: 'the agent queue still has open entries' }
  const cooldownMs = input.cooldownMs ?? DEFAULT_AUTO_PM_COOLDOWN_MS
  if (input.sinceLastStartMs !== undefined && input.sinceLastStartMs < cooldownMs) {
    return { start: false, reason: 'a run was started for this project a moment ago' }
  }
  return quotaHeadroom(input.quota, input.minFreePercent ?? DEFAULT_MIN_FREE_PERCENT)
}

/** A project the sweep considers. */
export interface AutoPmProject {
  /** Registry id, as `start` and the live-run lookup take it. */
  id: string
  /** Absolute repo path, for reading its queue. */
  path: string
}

/** The readings and effects {@link startAutoPm} needs, injected so the loop is testable off disk. */
export interface AutoPmDeps {
  /** The projects to consider. */
  projects(): Promise<readonly AutoPmProject[]>
  /** The `autoPm` preference, re-read per tick so the toggle takes effect without a restart. */
  enabled(): Promise<boolean>
  /** Whether a project's agent queue has run dry. */
  backlogEmpty(project: AutoPmProject): Promise<boolean>
  /** How many runs are live on a project. */
  activeRuns(project: AutoPmProject): number
  /** The current consumption reading, or `undefined` when there is none. */
  quota(): Promise<ConsumptionStatus | undefined>
  /** Start the PM run. Resolves false when the daemon refused, so the cooldown is not armed. */
  start(project: AutoPmProject): Promise<boolean>
  /** Progress line. */
  log(message: string): void
  /** Override the tick interval. */
  intervalMs?: number
  /** Override the per-project cooldown. */
  cooldownMs?: number
  /** Override the headroom threshold. */
  minFreePercent?: number
  /** Clock, injectable for tests. */
  now?: () => number
}

/** A running sweep. */
export interface AutoPmLoop {
  /** Run one sweep now, rather than waiting for the next tick. Exposed for tests. */
  tick(): Promise<void>
  stop(): void
}

/**
 * Start the auto-PM sweep (#685): every {@link DEFAULT_AUTO_PM_INTERVAL_MS}, ask
 * {@link autoPmDecision} for each project and start a run for the ones that say yes.
 *
 * Ticks never overlap — a sweep reads a live-run map that its own `start` calls mutate,
 * so a second sweep running over the first would decide against a stale picture.
 *
 * Nothing here survives the daemon: per #519 a Ctrl+C that stops everything is the feature,
 * not a gap, so this loop is deliberately not restartable from outside the process.
 */
export function startAutoPm(deps: AutoPmDeps): AutoPmLoop {
  const now = deps.now ?? (() => Date.now())
  const lastStart = new Map<string, number>()
  let sweeping = false

  const tick = async (): Promise<void> => {
    if (sweeping) return
    sweeping = true
    try {
      // The preference is the cheapest gate and the one the user flips most, so it is read
      // once per sweep rather than per project.
      if (!(await deps.enabled().catch(() => false))) return
      const projects = await deps.projects().catch(() => [])
      if (!projects.length) return
      // One reading for the whole sweep: it is an account-wide meter, and re-reading it per
      // project would spend a rate-limited call to learn the same number.
      const quota = await deps.quota().catch(() => undefined)
      for (const project of projects) {
        const since = lastStart.get(project.id)
        const decision = autoPmDecision({
          enabled: true,
          backlogEmpty: await deps.backlogEmpty(project).catch(() => false),
          activeRuns: deps.activeRuns(project),
          quota,
          ...(since !== undefined ? { sinceLastStartMs: now() - since } : {}),
          ...(deps.minFreePercent !== undefined ? { minFreePercent: deps.minFreePercent } : {}),
          ...(deps.cooldownMs !== undefined ? { cooldownMs: deps.cooldownMs } : {}),
        })
        if (!decision.start) continue
        // Armed before the spawn, not after: starting is slow, and a tick that overlapped the
        // spawn would otherwise see no live run yet and start a second one.
        lastStart.set(project.id, now())
        deps.log(`[framework] auto PM: spiking & planning tickets in ${project.path}`)
        if (!(await deps.start(project).catch(() => false))) {
          lastStart.delete(project.id)
          deps.log(`[framework] auto PM: could not start a run in ${project.path}`)
        }
      }
    } finally {
      sweeping = false
    }
  }

  const timer = setInterval(() => void tick(), deps.intervalMs ?? DEFAULT_AUTO_PM_INTERVAL_MS)
  timer.unref?.() // a background sweep must never be the reason the process stays up
  return { tick, stop: () => clearInterval(timer) }
}
