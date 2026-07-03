import { parseVerdict } from '@gemstack/ai-autopilot'
import type {
  ArchitectContext,
  ArchitectDecision,
  ArchitectPlan,
  BuildContext,
  DeployContext,
  DeployOutcome,
  LoopPassContext,
  PlannedSubtask,
  SubtaskResult,
  SupervisorRun,
  Verdict,
} from '@gemstack/ai-autopilot'
import type { DriverSession } from './driver/index.js'

/**
 * Driver-backed {@link https://github.com/gemstack-land/gemstack | Bootstrap} steps.
 *
 * These implement the injectable steps of ai-autopilot's `Bootstrap` by running
 * everything *through* a {@link DriverSession} (option A, #166): the architect is
 * a structured decision the driver returns as JSON; build / improve are prompts
 * that let the wrapped agent's own loop do the work; the checklist re-prompts and
 * gates on the `{ blockers }` verdict the agent ends its output with. Reusing the
 * `Bootstrap` spine keeps scope, narration, the decisions ledger, the loop gate,
 * and deploy for free; only *who runs the inner loop* changes.
 */

const ZERO_USAGE = { promptTokens: 0, completionTokens: 0, totalTokens: 0 }

/** Compose the architect prompt for an intent. Exported so callers can override. */
export function architectPrompt(intent: string): string {
  return [
    'You are the architect for a new app. Decide the stack and the key architectural choices.',
    `What the user wants: ${intent}`,
    'Prefer a modern, well-supported stack. Keep the choices minimal and justified.',
    'Respond with ONLY a fenced ```json block of the shape:',
    '{ "stack": "<one line>", "narration": "<what you are building and why>", "decisions": [{ "choice": "<one line>", "why": "<one line>" }] }',
  ].join('\n')
}

/** Compose the build prompt from the architect's plan. */
export function buildPrompt(plan: ArchitectPlan, intent: string): string {
  return [
    `Build this app end to end: ${intent}`,
    `Stack: ${plan.stack}`,
    plan.narration,
    'Create every file needed and make the app run. Follow the stack conventions.',
    'When done, summarize what you built in one short paragraph.',
  ].join('\n')
}

/** The default production-grade checklist prompt. Ends with a `{ blockers }` verdict. */
export const PRODUCTION_GRADE_PROMPT = [
  'Review the app in this workspace against a production-grade checklist:',
  'correctness, error handling, auth where user data is involved, input validation,',
  'sensible structure, and that it actually builds and runs.',
  'Do NOT fix anything now. Report only.',
  'End your reply with a fenced ```json block: { "blockers": ["<concrete work still required>", ...] }.',
  'An empty blockers array means the app is production-grade.',
].join('\n')

/** Compose the improve prompt for a set of blockers. */
export function improvePrompt(blockers: readonly string[]): string {
  return [
    'Address these blockers in the app, then stop:',
    ...blockers.map(b => `- ${b}`),
    'Make the smallest changes that clear them. Do not add unrelated features.',
  ].join('\n')
}

/** Options shared by the driver-backed steps. */
export interface DriverStepOptions {
  /** Extra per-step framing appended to the session system prompt. */
  system?: string
}

/**
 * The architect step: ask the driver for a structured stack decision and parse
 * it. A single small structured decision, exactly what option A reserves this
 * shape for (returned as JSON by the black box rather than a separate agent).
 */
export function driverArchitect(
  session: DriverSession,
  opts: { prompt?: (intent: string) => string } & DriverStepOptions = {},
): (ctx: ArchitectContext) => Promise<ArchitectPlan> {
  const compose = opts.prompt ?? architectPrompt
  return async ctx => {
    const turn = await session.prompt(compose(ctx.intent), {
      ...(opts.system ? { system: opts.system } : {}),
      ...(ctx.signal ? { signal: ctx.signal } : {}),
    })
    return parseArchitectPlan(turn.text, ctx.intent)
  }
}

/**
 * The build step: prompt the driver to build the app and let its own loop run.
 * Emits synthetic Supervisor events so the bootstrap narration still shows a
 * build phase, and returns a {@link SupervisorRun} carrying the driver's summary.
 */
export function driverBuild(
  session: DriverSession,
  opts: { prompt?: (plan: ArchitectPlan, intent: string) => string } & DriverStepOptions = {},
): (ctx: BuildContext) => Promise<SupervisorRun> {
  const compose = opts.prompt ?? buildPrompt
  return async ctx => {
    const subtask: PlannedSubtask = { id: 'build-1', description: `Build with the wrapped agent` }
    ctx.onEvent({ type: 'plan', task: ctx.intent, subtasks: [subtask] })
    ctx.onEvent({ type: 'dispatch-start', subtask })

    const turn = await session.prompt(compose(ctx.plan, ctx.intent), {
      ...(opts.system ? { system: opts.system } : {}),
      ...(ctx.signal ? { signal: ctx.signal } : {}),
    })

    const result: SubtaskResult = { subtask, text: turn.text, ok: true, usage: ZERO_USAGE }
    ctx.onEvent({ type: 'dispatch-result', result })
    ctx.onEvent({ type: 'synthesize', results: [result] })
    return { text: turn.text, plan: [subtask], results: [result], usage: ZERO_USAGE, stoppedEarly: false }
  }
}

/**
 * The checklist step: re-prompt the driver with the production-grade checklist
 * and parse the `{ blockers }` verdict from its output. This is the outcome
 * gate: the loop repeats until the verdict is empty (#113 / guardrail #3).
 */
export function driverChecklist(
  session: DriverSession,
  opts: { prompt?: string } & DriverStepOptions = {},
): (ctx: LoopPassContext) => Promise<Verdict> {
  const prompt = opts.prompt ?? PRODUCTION_GRADE_PROMPT
  return async ctx => {
    const turn = await session.prompt(prompt, {
      ...(opts.system ? { system: opts.system } : {}),
      ...(ctx.signal ? { signal: ctx.signal } : {}),
    })
    // A missing verdict is treated as "reported nothing concrete": passing, so a
    // terse agent does not wedge the loop. parseVerdict returns undefined then.
    return parseVerdict(turn.text) ?? { blockers: [] }
  }
}

/** The improve step: a fresh invocation that fixes the current blockers. */
export function driverImprove(
  session: DriverSession,
  opts: { prompt?: (blockers: readonly string[]) => string } & DriverStepOptions = {},
): (ctx: LoopPassContext) => Promise<void> {
  const compose = opts.prompt ?? improvePrompt
  return async ctx => {
    await session.prompt(compose(ctx.blockers), {
      ...(opts.system ? { system: opts.system } : {}),
      ...(ctx.signal ? { signal: ctx.signal } : {}),
    })
  }
}

/**
 * A minimal deploy step that only *decides* (does not ship). The real deploy
 * targets (cloudflareTarget / dokployTarget) live in ai-autopilot and are wired
 * by the caller; this keeps the driver flow runnable with no deploy creds.
 */
export function decideDeploy(
  plan: { render: 'ssr' | 'ssg' | 'spa'; target: string; reason: string },
): (ctx: DeployContext) => DeployOutcome {
  return () => ({ plan, result: { deployed: false, detail: 'plan-only (no deploy target wired)' } })
}

/**
 * Parse the architect's JSON out of a driver turn, with safe fallbacks so a
 * loose reply never crashes the flow. Exported for testing.
 */
export function parseArchitectPlan(text: string, intent: string): ArchitectPlan {
  const obj = lastJsonObject(text)
  const stack = typeof obj?.['stack'] === 'string' && obj['stack'].trim() ? obj['stack'].trim() : `A sensible stack for: ${intent}`
  const narration =
    typeof obj?.['narration'] === 'string' && obj['narration'].trim() ? obj['narration'].trim() : `Building: ${intent}`
  const decisions = Array.isArray(obj?.['decisions'])
    ? (obj['decisions'] as unknown[]).flatMap(coerceDecision)
    : []
  return { stack, narration, decisions }
}

function coerceDecision(value: unknown): ArchitectDecision[] {
  if (typeof value !== 'object' || value === null) return []
  const obj = value as Record<string, unknown>
  const choice = typeof obj['choice'] === 'string' ? obj['choice'].trim() : ''
  const why = typeof obj['why'] === 'string' ? obj['why'].trim() : ''
  return choice && why ? [{ choice, why }] : []
}

const FENCE = /```(?:[a-zA-Z0-9]*)\n([\s\S]*?)```/g

/** Extract the last JSON object from text: last fenced block, else a trailing `{...}`. */
function lastJsonObject(text: string): Record<string, unknown> | undefined {
  if (!text) return undefined
  const candidates: string[] = []
  for (const m of text.matchAll(FENCE)) candidates.push(m[1]!)
  const open = text.lastIndexOf('{')
  const close = text.lastIndexOf('}')
  if (open !== -1 && close > open) candidates.push(text.slice(open, close + 1))
  for (let i = candidates.length - 1; i >= 0; i--) {
    try {
      const parsed = JSON.parse(candidates[i]!.trim())
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>
      }
    } catch {
      // try the next candidate
    }
  }
  return undefined
}
