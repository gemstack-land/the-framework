import { Agent } from '@gemstack/ai-sdk'
import type { TokenUsage } from '@gemstack/ai-sdk'
import { runPool } from './pool.js'
import { defaultSynthesize } from './synthesizer.js'
import type {
  PlannedSubtask,
  SubtaskResult,
  SupervisorOptions,
  SupervisorRun,
  WorkerRouter,
} from './types.js'

const ZERO_USAGE: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 }

/**
 * The supervisor/worker topology: **plan → dispatch → synthesize**.
 *
 * A planner decomposes the task into subtasks; the supervisor dispatches each
 * to a worker agent (bounded concurrency, optional token budget, per-subtask
 * error isolation); a synthesizer combines the results into the final answer.
 *
 * This is a control *policy* over `@gemstack/ai-sdk`'s single-agent primitives,
 * not a wrapper around any one of them — it owns which agents run, in what
 * order, how their results combine, and when to stop.
 *
 * ```ts
 * const supervisor = new Supervisor({
 *   plan: agentPlanner(plannerAgent),
 *   workers: { research: researchAgent, write: writerAgent },
 *   synthesize: agentSynthesizer(editorAgent),
 *   concurrency: 3,
 *   budget: { maxTotalTokens: 200_000 },
 * })
 * const { text } = await supervisor.run('Draft a launch brief for product X')
 * ```
 */
export class Supervisor {
  constructor(private readonly opts: SupervisorOptions) {}

  async run(task: string): Promise<SupervisorRun> {
    const concurrency = this.opts.concurrency ?? 4
    const route = resolveRouter(this.opts.workers)
    const synthesize = this.opts.synthesize ?? defaultSynthesize
    const emit = this.opts.onEvent ?? (() => {})

    let usage: TokenUsage = ZERO_USAGE
    let stoppedEarly = false

    // 1. Plan ────────────────────────────────────────────────
    const drafted = await this.opts.plan(task)
    let plan: PlannedSubtask[] = drafted.map((s, i) => ({ ...s, id: s.id ?? `subtask-${i + 1}` }))

    const cap = this.opts.maxSubtasks
    if (cap !== undefined && plan.length > cap) {
      const dropped = plan.length - cap
      plan = plan.slice(0, cap)
      stoppedEarly = true
      emit({ type: 'plan-trimmed', kept: plan.length, dropped, reason: 'maxSubtasks' })
    }
    emit({ type: 'plan', task, subtasks: plan })

    // 2. Dispatch ─────────────────────────────────────────────
    const limit = this.opts.budget?.maxTotalTokens
    const { results, stopped } = await runPool(
      plan,
      concurrency,
      async (subtask) => {
        emit({ type: 'dispatch-start', subtask })
        const result = await runSubtask(route, subtask)
        usage = addUsage(usage, result.usage)
        emit({ type: 'dispatch-result', result })
        return result
      },
      limit !== undefined ? () => usage.totalTokens >= limit : undefined,
    )

    if (stopped && limit !== undefined) {
      stoppedEarly = true
      emit({ type: 'budget-exceeded', spentTokens: usage.totalTokens, limitTokens: limit, skipped: plan.length - results.length })
    }

    // 3. Synthesize ───────────────────────────────────────────
    emit({ type: 'synthesize', results })
    const text = await synthesize(task, results)

    return { text, plan, results, usage, stoppedEarly }
  }
}

// ─── Internals ───────────────────────────────────────────────────

async function runSubtask(route: WorkerRouter, subtask: PlannedSubtask): Promise<SubtaskResult> {
  try {
    const agent = route(subtask)
    const response = await agent.prompt(subtask.description)

    // The seed dispatches autonomous workers. A worker that pauses for a
    // client-tool or approval round-trip can't be carried forward yet (durable
    // resume is a deferred adapter), so surface it as a failed subtask rather
    // than silently dropping the pause.
    if ((response.pendingClientToolCalls?.length ?? 0) > 0 || response.pendingApprovalToolCall) {
      return {
        subtask,
        text: response.text ?? '',
        ok: false,
        usage: response.usage ?? ZERO_USAGE,
        error: new Error(
          `[ai-autopilot] worker for "${subtask.id}" paused (${response.finishReason}); ` +
          `the Supervisor seed runs autonomous workers and cannot resume a paused run yet`,
        ),
      }
    }

    return { subtask, text: response.text ?? '', ok: true, usage: response.usage ?? ZERO_USAGE }
  } catch (error) {
    return { subtask, text: '', ok: false, error, usage: ZERO_USAGE }
  }
}

function resolveRouter(workers: SupervisorOptions['workers']): WorkerRouter {
  if (typeof workers === 'function') return workers
  if (workers instanceof Agent) return () => workers

  const pool = workers as Record<string, Agent>
  return (subtask) => {
    if (subtask.worker === undefined) {
      throw new Error(
        `[ai-autopilot] subtask "${subtask.id}" has no \`worker\` key, but \`workers\` is a pool. ` +
        `Set subtask.worker, or pass a single Agent / a WorkerRouter.`,
      )
    }
    const agent = pool[subtask.worker]
    if (!agent) {
      throw new Error(
        `[ai-autopilot] no worker named "${subtask.worker}" (subtask "${subtask.id}"). ` +
        `Known workers: ${Object.keys(pool).join(', ') || '(none)'}.`,
      )
    }
    return agent
  }
}

function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    promptTokens: a.promptTokens + b.promptTokens,
    completionTokens: a.completionTokens + b.completionTokens,
    totalTokens: a.totalTokens + b.totalTokens,
  }
}
