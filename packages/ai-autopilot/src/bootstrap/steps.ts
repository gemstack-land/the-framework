import { Output } from '@gemstack/ai-sdk'
import type { Agent } from '@gemstack/ai-sdk'
import { z } from 'zod'
import { Supervisor } from '../supervisor.js'
import { decisionBriefing } from '../decisions/tools.js'
import { LoopEngine } from '../loop/loop.js'
import { LOOP_EVENTS, LOOP_PROMPTS } from '../loop/policy.js'
import type { Planner, Synthesizer, SupervisorOptions } from '../types.js'
import type { Verdict } from '../loop/verdict.js'
import type { BootstrapSteps, BuildContext } from './types.js'

/**
 * Default wirings of the four bootstrap steps onto the real primitives —
 * Supervisor, personas, and the LoopEngine. Each is thin (it constructs a primitive
 * and adapts its I/O to the step contract), so the same orchestrator runs
 * against these in production or against stubs in a test. The model + runner stay
 * injected: you pass the architect agent, the planner/workers, and the loop.
 */

/** Options for {@link agentArchitect}. */
export interface ArchitectAgentOptions {
  /** Override the architect instruction prepended to the intent. */
  instructions?: string
}

/**
 * Objective, reusable stack tradeoffs the architect grounds its justification in,
 * so the PROS/CONS it reports are real reasons rather than invented per run. Kept
 * as one exported block so the ai-sdk architect and the driver architect
 * (framework) share the same knowledge. Extend it as the default stack evolves.
 */
export const STACK_TRADEOFFS = `Ground the stack justification in these objective tradeoffs, do not invent reasons:
- Vike (Vite + SSR, renderer-agnostic): deploys anywhere including edge/serverless
  (Cloudflare, Vercel, Node); works with React, Vue, or Solid; lighter and less
  opinionated. Downsides: fewer batteries-included conventions and a smaller
  ecosystem than Next.
- Next.js (App Router + React Server Components): largest ecosystem, batteries
  included (image/font/routing), first-class Vercel deploy. Downsides: heavier,
  React-only, a more opinionated server model, and more constrained edge/Cloudflare
  support.
Weigh these against the app's actual needs. Neither is a default; pick the one
the requirements point to.`

const DEFAULT_ARCHITECT_INSTRUCTIONS = `You are the lead architect. Choose the stack and structure for the app the user
describes and commit to it — act like a senior engineer who decides and explains,
not one who asks permission. Choose the stack that best fits what the user is
building. Only choose packages that are published and installable on npm.
Narrate what you are building
and why in a sentence or two, and list the key choices so they are recorded and
not re-litigated later.

Justify the stack honestly: give its real PROS and its CONS (every stack has
tradeoffs), and name the main alternative you rejected and why it lost. This is
shown to the user as the rationale, so be concrete, not promotional.

${STACK_TRADEOFFS}`

/**
 * An architect step backed by an `ai-sdk` agent. It prompts the agent for a
 * structured `{ stack, narration, decisions }` plan (via `Output.object`), and
 * prepends the decisions briefing so it does not re-pitch an already-rejected
 * idea. The orchestrator records the returned choices to the ledger.
 */
export function agentArchitect(architect: Agent, opts: ArchitectAgentOptions = {}): BootstrapSteps['architect'] {
  const schema = z.object({
    stack: z.string().describe('The chosen stack, one line'),
    narration: z.string().describe('What you are building and why, to tell the user'),
    decisions: z
      .array(z.object({ choice: z.string(), why: z.string() }))
      .describe('Key architectural choices and their rationale'),
    pros: z.array(z.string()).describe('Why the chosen stack fits — its real upsides').optional(),
    cons: z.array(z.string()).describe('Honest downsides / tradeoffs of the chosen stack').optional(),
    alternatives: z
      .array(z.object({ option: z.string(), whyNot: z.string() }))
      .describe('Stacks considered but rejected, and why each lost')
      .optional(),
  })
  const output = Output.object({ schema })
  const instructions = opts.instructions ?? DEFAULT_ARCHITECT_INSTRUCTIONS

  return async ({ intent, scope, ledger }) => {
    const briefing = decisionBriefing(ledger)
    const head = briefing ? `${briefing}\n\n${instructions}` : instructions
    const prompt = `${head}\n\n# What the user wants (${scope})\n${intent}\n\n${output.toSystemPrompt()}`
    const response = await architect.prompt(prompt)
    const parsed = output.parse(response.text ?? '')
    // Omit the rationale fields when absent rather than setting them to
    // `undefined` (exactOptionalPropertyTypes), so consumers see a clean plan.
    return {
      stack: parsed.stack,
      narration: parsed.narration,
      decisions: parsed.decisions,
      ...(parsed.pros?.length ? { pros: parsed.pros } : {}),
      ...(parsed.cons?.length ? { cons: parsed.cons } : {}),
      ...(parsed.alternatives?.length ? { alternatives: parsed.alternatives } : {}),
    }
  }
}

/** Options for {@link supervisorBuild}. */
export interface SupervisorBuildOptions {
  /** How to decompose the build into subtasks (usually `agentPlanner(...)`). */
  plan: Planner
  /** The worker agents (usually persona workers with runner tools). */
  workers: SupervisorOptions['workers']
  synthesize?: Synthesizer
  concurrency?: number
  budget?: SupervisorOptions['budget']
  /** Build the task text from the plan + intent. Default: intent + chosen stack. */
  task?: (ctx: BuildContext) => string
}

const defaultBuildTask = (ctx: BuildContext): string =>
  `Build the app.\n\n# Goal\n${ctx.intent}\n\n# Stack\n${ctx.plan.stack}`

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
  /** The event kind whose chain runs the checklist prompt. Default `production-check`. */
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
  const kind = opts.kind ?? 'production-check'
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
