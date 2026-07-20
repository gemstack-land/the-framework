import type { ConsumptionStatus } from './consumption.js'
import { renderSpikeAndPlanPrompt, SPIKE_AND_PLAN_PRESET_NAME } from './spike-and-plan-preset.js'
import { renderQuickWinsPrompt, QUICK_WINS_PRESET_NAME } from './quick-wins-preset.js'
import { renderDrainQueuePrompt, DRAIN_QUEUE_PRESET_NAME } from './drain-queue-preset.js'

/**
 * Auto PM (#685): spend leftover subscription quota on product management instead of
 * letting it expire. While the configured usage limits are not met and nobody is at the
 * keyboard, the daemon runs the cycle by itself: it works the agent queue down entry by entry (#855),
 * and once that is empty it refills it — harvesting quick-wins, then spiking and planning
 * the tickets that have neither yet.
 *
 * The whole feature is one policy question ("is now a good time to spend tokens on our
 * own roadmap?"), so that question lives here as a pure function and the daemon only
 * supplies the readings. #298 is the parent idea (background jobs / "max out the usage"),
 * and #519 already built the meter this reads.
 */

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
  /**
   * Whether the project's agent queue (`TODO_AGENTS.md`) has no open entry left, or `undefined`
   * when it could not be read. Unreadable is not empty and not full: it fails closed, because
   * since #855 both answers now *start* something and only "we could not tell" does not.
   */
  backlogEmpty: boolean | undefined
  /** Live runs on this project. Any run at all means the user's quota is already being spent. */
  activeRuns: number
  /** The budget readings, or `undefined` when the quota could not be read. */
  quota: AutoPmQuota | undefined
  /** Milliseconds since this project was last auto-started, or `undefined` if it never was. */
  sinceLastStartMs?: number
  /** Override {@link DEFAULT_AUTO_PM_COOLDOWN_MS}. */
  cooldownMs?: number
}

/** Why the sweep is not starting anything. Logged, so it reads as a sentence. */
export type AutoPmRefusal = { start: false; reason: string }

/**
 * Which half of the cycle a start belongs to (#855). `drain` works an entry the queue already
 * holds; `pm` puts new work in it. The queue decides: standing work is spent before more is made.
 */
export type AutoPmMode = 'drain' | 'pm'

/** Whether the budget allows spending unasked at all, before asking what to spend it on. */
export type QuotaDecision = { start: true } | AutoPmRefusal

/** Start (and at what), or the reason not to. */
export type AutoPmDecision = { start: true; mode: AutoPmMode } | AutoPmRefusal

/**
 * What one tick knows about the budget: where the user's configured limits stand.
 *
 * It used to carry the account's own absolute weekly figure as well (#848), to cover the
 * rolling meter reading zero after a restart. That was only meaningful next to a percentage
 * threshold, and #870 removed the threshold, so it went with it rather than sitting here unread.
 */
export interface AutoPmQuota {
  /** Where the user's configured limits stand, from the rolling meter. */
  status: ConsumptionStatus
}

/**
 * Whether the budget allows spending unasked.
 *
 * The gate is the user's own configured limits (#870): auto PM starts while they are not met
 * and stands down once one is. It used to require half of every budget still free, which was a
 * second budget notion nobody had asked for — and two sets of limits to reason about is worse
 * than one, even when the extra one is stricter.
 *
 * `status.reached` is that question already answered: "the limit to pause for, or null",
 * widest-first, so the window it names is the one that takes longest to recover.
 *
 * **It still fails closed on a quota it cannot read at all, and that is the opposite of the
 * per-run guard.** #519 settled that an unreadable quota must never *stop* the user's own work,
 * so `startConsumptionGuard` fails open. Work nobody asked for is the other way round: quietly
 * burning a subscription is a far worse failure than skipping a tick. That is a separate
 * property from the threshold, so dropping the threshold left it alone.
 *
 * Note what this no longer covers. `reached` reads the rolling meter, which is delta-based: a
 * restarted daemon has nothing to diff and honestly reports zero consumed however much the
 * account has spent (#848). With no configured limit to trip, nothing then stands between a
 * fresh daemon and work nobody asked for. Raised on #870 as a decision rather than fixed here,
 * since the answer is a limit that stops unattended work specifically.
 */
export function quotaHeadroom(quota: AutoPmQuota | undefined): QuotaDecision {
  if (!quota) return { start: false, reason: 'the quota could not be read, so there is no way to tell what is spare' }
  if (quota.status.reached) return { start: false, reason: `the ${quota.status.reached} limit is reached` }
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
  const cooldownMs = input.cooldownMs ?? DEFAULT_AUTO_PM_COOLDOWN_MS
  if (input.sinceLastStartMs !== undefined && input.sinceLastStartMs < cooldownMs) {
    return { start: false, reason: 'a run was started for this project a moment ago' }
  }
  if (input.backlogEmpty === undefined) {
    return { start: false, reason: 'the agent queue could not be read, so there is no way to tell what to do' }
  }
  const headroom = quotaHeadroom(input.quota)
  if (!headroom.start) return headroom
  // The queue picks the job, and a non-empty one wins (#855). It used to be a refusal, on the
  // reasoning that the backlog loop would drain it — but that loop only exists inside a run a
  // human started, so unattended the queue filled once and nothing ever emptied it again.
  return { start: true, mode: input.backlogEmpty ? 'pm' : 'drain' }
}

/**
 * One thing auto PM knows how to do while the machine is idle (#773).
 *
 * The jobs form a cycle, and the order matters: [Quick wins] turns existing plans into queued
 * work, [Spike & plan] turns tickets into plans. Harvesting first means a machine that already
 * has plans starts *doing* rather than planning more. Once a job queues something the sweep
 * switches to draining it (#855), and the rotation resumes where it left off once the queue is
 * empty again.
 */
export interface AutoPmJob {
  /** Stable id, used for the rotation and the log line. */
  name: string
  /** The prompt to run, verbatim. */
  prompt: string
  /** What it is doing, as the log line says it ("harvesting quick-wins"). */
  describe: string
}

/**
 * The default cycle: harvest the plans we have (#773), then make more plans (#685). Quick wins
 * lead because a machine sitting on unharvested plans should start doing rather than planning.
 */
export const AUTO_PM_JOBS: readonly AutoPmJob[] = [
  { name: QUICK_WINS_PRESET_NAME, prompt: renderQuickWinsPrompt(), describe: 'harvesting quick-wins from the plans' },
  { name: SPIKE_AND_PLAN_PRESET_NAME, prompt: renderSpikeAndPlanPrompt(), describe: 'spiking & planning tickets' },
]

/**
 * The job for a queue that is not empty (#855): work its first entry off. Outside the rotation
 * on purpose — the rotation is about what to *make* when there is nothing to do, and this is
 * the thing to do.
 */
export const AUTO_PM_DRAIN_JOB: AutoPmJob = {
  name: DRAIN_QUEUE_PRESET_NAME,
  prompt: renderDrainQueuePrompt(),
  describe: 'draining the first open queue entry',
}

/**
 * What became of one attempt to land a run's queue (#852). The two flags are separate on purpose:
 * a finished run that wrote no queue is `settled` without being `promoted`, and must stop being
 * retried; a still-running one is neither, and is tried again next tick.
 */
export interface PromoteOutcome {
  /** Stop tracking this run: it is finished, whether or not it left anything behind. */
  settled: boolean
  /** The checkout's queue actually changed. */
  promoted: boolean
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
  /** The current budget readings, or `undefined` when there are none. */
  quota(): Promise<AutoPmQuota | undefined>
  /** The jobs to rotate through, in cycle order. Used only while the queue is empty. */
  jobs: readonly AutoPmJob[]
  /** The job for a queue with open entries (#855); {@link AUTO_PM_DRAIN_JOB} by default. */
  drainJob?: AutoPmJob
  /** Start the PM run. Resolves the run's id, or undefined when the daemon refused. */
  start(project: AutoPmProject, job: AutoPmJob): Promise<string | undefined>
  /**
   * Land a finished run's queue in the project checkout (#852). Called before the sweep decides
   * anything: a run's queue lives on its own worktree branch, so until it is promoted the checkout
   * still reads empty and the sweep would start the same work over again.
   */
  promote(project: AutoPmProject, runId: string): Promise<PromoteOutcome>
  /** Progress line. */
  log(message: string): void
  /** Override the tick interval. */
  intervalMs?: number
  /** Override the per-project cooldown. */
  cooldownMs?: number
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
  // Runs this loop started whose queue has not reached the checkout yet, oldest first.
  const pending = new Map<string, string[]>()
  // Where each project is in the job cycle. Per project, not global: two repos idle at once
  // should each work through the rotation, not take alternate halves of it.
  const nextJob = new Map<string, number>()
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
        // Land anything a previous run produced before judging whether the queue is empty:
        // its entries are still on that run's branch, and the checkout cannot see them.
        const outstanding = pending.get(project.id) ?? []
        if (outstanding.length) {
          const stillPending: string[] = []
          let landed = 0
          for (const runId of outstanding) {
            const outcome = await deps.promote(project, runId).catch(() => ({ settled: false, promoted: false }))
            if (outcome.promoted) landed++
            if (!outcome.settled) stillPending.push(runId)
          }
          if (stillPending.length) pending.set(project.id, stillPending)
          else pending.delete(project.id)
          if (landed) {
            // The queue the decision below reads was just filled, so that read is stale. Leave it
            // to the next tick, and let the backlog loop have the work in the meantime.
            deps.log(`[framework] auto PM: landed the queue from ${landed} run(s) in ${project.path}`)
            continue
          }
        }
        const since = lastStart.get(project.id)
        const decision = autoPmDecision({
          enabled: true,
          backlogEmpty: await deps.backlogEmpty(project).catch(() => undefined),
          activeRuns: deps.activeRuns(project),
          quota,
          ...(since !== undefined ? { sinceLastStartMs: now() - since } : {}),
          ...(deps.cooldownMs !== undefined ? { cooldownMs: deps.cooldownMs } : {}),
        })
        if (!decision.start) {
          // Logged, so a wedged sweep is distinguishable from a healthy idle one (#855).
          deps.log(`[framework] auto PM: standing down for ${project.path} — ${decision.reason}`)
          continue
        }
        const index = nextJob.get(project.id) ?? 0
        const job = decision.mode === 'drain' ? (deps.drainJob ?? AUTO_PM_DRAIN_JOB) : deps.jobs[index % deps.jobs.length]
        if (!job) continue
        // Armed before the spawn, not after: starting is slow, and a tick that overlapped the
        // spawn would otherwise see no live run yet and start a second one.
        lastStart.set(project.id, now())
        deps.log(`[framework] auto PM: ${job.describe} in ${project.path}`)
        const runId = await deps.start(project, job).catch(() => undefined)
        if (runId) {
          // Advanced only on a start that took, so a refused job is retried rather than skipped.
          // Draining does not advance it: it is not part of the cycle, and a queue worked off
          // over several ticks must not skip the rotation forward once per entry.
          if (decision.mode === 'pm') nextJob.set(project.id, index + 1)
          // Its queue lives on the run's branch until a later tick promotes it.
          pending.set(project.id, [...(pending.get(project.id) ?? []), runId])
        } else {
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
