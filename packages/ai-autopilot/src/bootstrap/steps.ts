import { Supervisor } from '../supervisor.js'
import { LoopEngine } from '../loop/loop.js'
import { LOOP_EVENTS, LOOP_PROMPTS } from '../loop/policy.js'
import type { Planner, Synthesizer, SupervisorOptions } from '../types.js'
import type { Verdict } from '../loop/verdict.js'
import type { BootstrapSteps, BuildContext } from './types.js'

/**
 * Default wirings of the bootstrap steps onto the real primitives — Supervisor
 * and the LoopEngine. Each is thin (it constructs a primitive and adapts its I/O
 * to the step contract), so the same orchestrator runs against these in
 * production or against stubs in a test. The model + runner stay injected: you
 * pass the planner/workers and the loop.
 */

/** Options for {@link supervisorBuild}. */
export interface SupervisorBuildOptions {
  /** How to decompose the build into subtasks (usually `agentPlanner(...)`). */
  plan: Planner
  /** The worker agents (usually persona workers with runner tools). */
  workers: SupervisorOptions['workers']
  synthesize?: Synthesizer
  concurrency?: number
  budget?: SupervisorOptions['budget']
  /** Build the task text from the intent. Default: the intent alone. */
  task?: (ctx: BuildContext) => string
}

const defaultBuildTask = (ctx: BuildContext): string => `Build the app.\n\n# Goal\n${ctx.intent}`

/**
 * A build step that runs the {@link Supervisor} over the given planner + workers,
 * forwarding its events to bootstrap's narration. The Supervisor has no native
 * abort, so the step honors `signal` by not starting once it is already aborted.
 */
export function supervisorBuild(opts: SupervisorBuildOptions): BootstrapSteps['build'] {
  const makeTask = opts.task ?? defaultBuildTask
  return async ctx => {
    if (ctx.signal?.aborted) throw new Error('[ai-autopilot] build aborted before start')
    const supervisor = new Supervisor({
      plan: opts.plan,
      workers: opts.workers,
      ...(opts.synthesize ? { synthesize: opts.synthesize } : {}),
      ...(opts.concurrency ? { concurrency: opts.concurrency } : {}),
      ...(opts.budget ? { budget: opts.budget } : {}),
      onEvent: ctx.onEvent,
    })
    return supervisor.run(makeTask(ctx))
  }
}

/** Options for {@link loopChecklist} and {@link loopImprove}. */
export interface LoopStepOptions {
  /** The loop that resolves the prompt ids to bodies (via `loopPromptsFor`). */
  loop: LoopEngine
}

/** Options for {@link loopChecklist}. */
export interface LoopChecklistOptions extends LoopStepOptions {
  /** The event kind whose chain runs the checklist prompt. Default `production-check`, which `defaultLoops()` defines. */
  kind?: string
  /** The prompt id to read the `{ blockers }` verdict from. Default `production-grade`. */
  promptId?: string
}

/**
 * A checklist step that fires a check event into the loop and returns the
 * {@link Verdict} the production-grade prompt reported. A missing verdict is
 * treated as a blocker (the checklist must return one to pass).
 */
export function loopChecklist(opts: LoopChecklistOptions): NonNullable<BootstrapSteps['checklist']> {
  const kind = opts.kind ?? LOOP_EVENTS.productionCheck
  const promptId = opts.promptId ?? LOOP_PROMPTS.productionGrade
  return async ({ intent, blockers }) => {
    const summary = blockers.length ? `Re-check after addressing: ${blockers.join('; ')}` : intent
    const result = await opts.loop.handle({ kind, summary })
    const outcome = result.outcomes.find(o => o.promptId === promptId)
    return outcome?.verdict ?? ({ blockers: [`checklist "${promptId}" did not return a verdict`] } satisfies Verdict)
  }
}

/** Options for {@link loopImprove}. */
export interface LoopImproveOptions extends LoopStepOptions {
  /** Change event kinds to fire so the review / QA chains run. Default `major-change`. */
  kinds?: string[]
}

/**
 * An improve step that fires the change events into the loop, so its review /
 * code-quality / security (and QA / UX) prompts run with fresh context against
 * the current app before the next checklist. The prompt agents do the fixing
 * (they carry the runner tools); this step just triggers the chains.
 */
export function loopImprove(opts: LoopImproveOptions): NonNullable<BootstrapSteps['improve']> {
  const kinds = opts.kinds ?? [LOOP_EVENTS.majorChange]
  return async ({ blockers }) => {
    const summary = blockers.length ? `Address blockers: ${blockers.join('; ')}` : 'Improve the app toward production-grade'
    for (const kind of kinds) {
      await opts.loop.handle({ kind, summary })
    }
  }
}
