import type { QuotaBoundaryStatus } from './quota-boundary.js'
import { renderSpikeAndPlanPrompt, SPIKE_AND_PLAN_PRESET_NAME } from './spike-and-plan-preset.js'
import { renderQuickWinsPrompt, QUICK_WINS_PRESET_NAME } from './quick-wins-preset.js'
import { renderDrainQueuePrompt, DRAIN_QUEUE_PRESET_NAME } from './drain-queue-preset.js'
import { renderMaintenancePrompt, MAINTENANCE_PRESET_NAME } from './maintenance-preset.js'
import {
  renderTriageQuickPrompt,
  TRIAGE_QUICK_PRESET_NAME,
  renderTriageConsensualPrompt,
  TRIAGE_CONSENSUAL_PRESET_NAME,
} from './triage-presets.js'

/**
 * Auto PM (#685): spend leftover subscription quota on product management instead of
 * letting it expire. While the account is still under its quota boundary (#879) and nobody
 * is at the keyboard, the daemon runs the cycle by itself: it works the agent queue down entry by entry (#855),
 * and once that is empty it refills it — harvesting quick-wins, then spiking and planning
 * the tickets that have neither yet.
 *
 * The whole feature is one policy question ("is now a good time to spend tokens on our
 * own roadmap?"), so that question lives here as a pure function and the daemon only
 * supplies the readings. #298 is the parent idea (background jobs / "max out the usage"),
 * and #879 defines the boundary this reads.
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
  /** Where the account stands against its quota boundary, or `undefined` when it could not be read. */
  quota: QuotaBoundaryStatus | undefined
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
 * Whether the budget allows spending unasked.
 *
 * The gate is the quota boundary (#879): by the nth day of the quota week, at most n/7 of the
 * week's allowance should be gone, so auto PM spends up to that line and stands down at it.
 * Work the user asks for is free to cross it and borrow against the days still to come; work
 * nobody asked for is exactly what the line is there to stop.
 *
 * **It fails closed on a quota it cannot read, and that is the opposite of the per-run guard.**
 * #519 settled that an unreadable quota must never *stop* the user's own work, so
 * `startConsumptionGuard` fails open. Quietly burning a subscription on work nobody asked for
 * is a far worse failure than skipping a tick.
 *
 * Reading the account's own week also means a restarted daemon is not blind: the figure is
 * absolute and complete, unlike the delta meter this replaced, which reported zero consumed
 * after a restart however much the account had spent (#848).
 */
export function quotaHeadroom(quota: QuotaBoundaryStatus | undefined): QuotaDecision {
  if (!quota) return { start: false, reason: 'the quota could not be read, so there is no way to tell what is spare' }
  const reached = quota.reached
  if (reached) {
    return {
      start: false,
      reason: `${reached.label} is ${Math.round(reached.percentUsed)}% used, at or past day ${quota.boundary.day} of the week's ${Math.round(quota.boundary.percent)}%`,
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
 * The default cycle, ordered cheapest-and-readiest first: harvest the plans we have (#773), triage
 * the quick tickets (#891), then the significant-but-agreed ones (#892), and only then make more
 * plans (#685). A machine sitting on work it has already thought through should start *doing*
 * rather than planning, and planning is both the most expensive turn and the one whose output the
 * earlier jobs consume.
 *
 * This rotation is what #891/#892 mean by "with a cron job regularly firing this preset". No
 * separate scheduler is involved and none is needed: the rotation already fires on every idle tick
 * where the queue is dry, which is exactly when the queue wants refilling. That is the opposite of
 * the maintenance sweep (#882), which is paced by a calendar because it looks at static history and
 * would otherwise never come due — hence its own {@link AUTO_PM_MAINTENANCE_JOB} outside the cycle.
 *
 * The gated triage sibling (#698) is deliberately not here: it ends in `<AWAIT>`, so firing it with
 * nobody at the keyboard would park a run against a human who will never answer.
 *
 * Each triage prompt pins its own session name and aborts if that branch already exists, so a
 * rotation that comes round again while the previous triage is still in flight is a no-op rather
 * than a duplicate. The rotation still advances past it, which is the wanted behaviour: the next
 * idle tick tries the next job instead of retrying a job that is already running.
 */
export const AUTO_PM_JOBS: readonly AutoPmJob[] = [
  { name: QUICK_WINS_PRESET_NAME, prompt: renderQuickWinsPrompt(), describe: 'harvesting quick-wins from the plans' },
  { name: TRIAGE_QUICK_PRESET_NAME, prompt: renderTriageQuickPrompt(), describe: 'triaging quick-win tickets' },
  {
    name: TRIAGE_CONSENSUAL_PRESET_NAME,
    prompt: renderTriageConsensualPrompt(),
    describe: 'triaging consensual tickets',
  },
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
 * The periodic codebase-wide sweep (#882): fire the [Maintenance] preset (#881) so a repo that
 * adopted The Framework late gets its pre-existing history looked at.
 *
 * Outside the rotation, like {@link AUTO_PM_DRAIN_JOB} and for the same kind of reason: the
 * rotation is "what to make next" and cycles every idle tick, while this is paced by a calendar
 * and must not advance or be advanced by the cycle. It takes precedence over the rotation when
 * due, because the entries it queues are what the rotation would otherwise be inventing work
 * instead of.
 *
 * The prompt renders at module load with no session, so `tf.params.what` falls back to its
 * default of the entire codebase, which is exactly this job's scope.
 */
export const AUTO_PM_MAINTENANCE_JOB: AutoPmJob = {
  name: MAINTENANCE_PRESET_NAME,
  prompt: renderMaintenancePrompt(),
  describe: 'sweeping the codebase for maintenance work',
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
  /** Where the account stands against its boundary, or `undefined` when there is no reading. */
  quota(): Promise<QuotaBoundaryStatus | undefined>
  /** The jobs to rotate through, in cycle order. Used only while the queue is empty. */
  jobs: readonly AutoPmJob[]
  /** The job for a queue with open entries (#855); {@link AUTO_PM_DRAIN_JOB} by default. */
  drainJob?: AutoPmJob
  /**
   * Whether a project is due its periodic codebase sweep (#882). Injected rather than computed
   * here because the schedule lives in a file in the project checkout, and this module is pure
   * policy. Omitted entirely (or throwing) means "not due", so a daemon that cannot read the
   * schedule keeps doing the rotation rather than sweeping on every tick.
   */
  maintenanceDue?(project: AutoPmProject): Promise<boolean>
  /** Stamp a project as swept, so the next sweep is an interval away. Paired with {@link AutoPmDeps.maintenanceDue}. */
  recordMaintenance?(project: AutoPmProject): Promise<void>
  /** The job fired when {@link AutoPmDeps.maintenanceDue} says yes; {@link AUTO_PM_MAINTENANCE_JOB} by default. */
  maintenanceJob?: AutoPmJob
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
        // A due codebase sweep (#882) outranks the rotation: the rotation invents work, and the
        // sweep is a standing instruction to go find some. Only ever while the queue is empty --
        // a repo with entries waiting has plenty to do, and the sweep would only add more.
        const sweep = decision.mode === 'pm' && (await deps.maintenanceDue?.(project).catch(() => false)) === true
        const job = sweep
          ? (deps.maintenanceJob ?? AUTO_PM_MAINTENANCE_JOB)
          : decision.mode === 'drain'
            ? (deps.drainJob ?? AUTO_PM_DRAIN_JOB)
            : deps.jobs[index % deps.jobs.length]
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
          //
          // A sweep does not advance it either, and stamps its own schedule instead: it is paced
          // by the calendar, not the cycle, so borrowing this tick must not cost the rotation its
          // turn. Stamped after the start took for the same reason the rotation is -- a sweep the
          // daemon refused should be retried next tick, not postponed a whole interval.
          if (sweep) await deps.recordMaintenance?.(project).catch(() => {})
          else if (decision.mode === 'pm') nextJob.set(project.id, index + 1)
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
