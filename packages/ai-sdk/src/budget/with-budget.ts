import type {
  AiMessage,
  AiMiddleware,
  ContentPart,
  MiddlewareContext,
} from '../types.js'
import {
  BudgetExceededError,
  ModelPricing,
  assertKnownModelPricing,
  type ModelPriceEntry,
} from './pricing.js'
import type {
  BudgetPeriod,
  BudgetStorage,
} from './storage.js'

/**
 * Per-period caps in USD. Either or both can be set; periods with `null`
 * / `undefined` are not enforced.
 */
export interface BudgetCaps {
  daily?:   number | null
  monthly?: number | null
}

export interface BudgetExceededArgs {
  userId: string
  period: BudgetPeriod
  /** Spend recorded BEFORE the rejected debit. */
  spent:  number
  cap:    number
  ctx:    MiddlewareContext
}

export interface WithBudgetOptions {
  /**
   * Resolves the user identifier for a given request. Return `null` (or
   * `undefined`) to bypass budget enforcement entirely — useful for
   * unauthenticated paths or admin tooling.
   *
   * Async return supported.
   */
  user(ctx: MiddlewareContext): string | null | undefined | Promise<string | null | undefined>

  /**
   * USD caps for the resolved user. Called once per request (per agent
   * step, more precisely). Caps may be set per-tier / per-plan by reading
   * the user from your DB inside the callback.
   */
  budget(args: { userId: string; ctx: MiddlewareContext }): BudgetCaps | Promise<BudgetCaps>

  /**
   * Where counters persist. Use {@link memoryBudgetStorage} for tests +
   * single-process dev; `ormBudgetStorage` (#A6 Phase 4) for production.
   */
  storage: BudgetStorage

  /**
   * Pricing catalog. Defaults to the shipped {@link ModelPricing}; spread
   * to override entries for negotiated rates:
   *
   * ```ts
   * pricing: { ...ModelPricing, 'anthropic/claude-opus-4-7': { ... } }
   * ```
   */
  pricing?: Record<string, ModelPriceEntry>

  /**
   * Called when a debit would exceed a cap. Default throws
   * {@link BudgetExceededError}; supply your own to log/alert before
   * throwing, or to throw a different error class. Must throw — return
   * value is ignored. The throw aborts the agent run before the model
   * call.
   */
  onExceeded?(args: BudgetExceededArgs): never | Promise<never>

  /**
   * IANA timezone for daily / monthly period rollover. Defaults to UTC.
   * Use the user's tz to roll caps at user-local midnight (matches
   * billing dashboards).
   */
  timezone?: string

  /**
   * Approximate-tokens estimator used for the pre-debit. Defaults to
   * `Math.ceil(text.length / 4)` — fine for English-heavy prompts. Pass
   * a tiktoken-backed estimator for accuracy.
   */
  estimateTokens?: (text: string) => number
}

const BudgetState = Symbol.for('rudderjs.ai.budget.state')

interface BudgetRunState {
  userId: string
  /** Periods + caps to debit against on this run, locked at first onConfig('beforeModel'). */
  caps:   Array<{ period: BudgetPeriod; cap: number }>
  /** USD pre-debited for the upcoming step; cleared on onUsage. */
  pendingEstimate: number
}

interface ContextWithBudgetState extends MiddlewareContext {
  [BudgetState]?: BudgetRunState
}

/**
 * Per-user spend cap middleware (#A6 Phase 3).
 *
 * Pre-debits an input-cost estimate before each provider call (refusing
 * with {@link BudgetExceededError} if the user would exceed any
 * configured cap), then debits the actual cost difference once the
 * `usage` chunk arrives.
 *
 * The pre-debit reserves budget so two concurrent requests can't both
 * pass the check before either is billed — the `BudgetStorage` contract
 * (#A6 Phase 2) requires `checkAndDebit` to be atomic.
 *
 * # Example
 *
 * ```ts
 * import { withBudget, memoryBudgetStorage, ModelPricing } from '@gemstack/ai-sdk'
 *
 * const budgeted = withBudget({
 *   user:    (ctx) => ctx.context as string,        // your app's user-id source
 *   budget:  () => ({ daily: 0.50, monthly: 10 }),  // USD
 *   storage: memoryBudgetStorage(),
 *   pricing: ModelPricing,
 * })
 *
 * class MyAgent extends Agent {
 *   middleware() { return [budgeted] }
 * }
 * ```
 *
 * # Caveats
 *
 * - **Refunds on errors are not issued.** If the provider call fails
 *   after the pre-debit, the estimate stays debited. This avoids the
 *   complexity of distinguishing partial-credit cases (the model may
 *   have produced output before erroring). Apps that need refund-on-error
 *   should subscribe via `onError` and call `storage` directly.
 * - **Cache token deltas not counted.** `TokenUsage` does not yet expose
 *   `cacheReadInputTokens` / `cacheWriteInputTokens`; cached requests are
 *   billed at the full `inputPer1k` rate today. Refining this is a phase
 *   3.x follow-up that needs a `TokenUsage` widening.
 * - **Tokenizer differences.** The default token estimator is
 *   `text.length / 4`. Provider-reported `usage.promptTokens` may differ
 *   by a few percent. Pass `estimateTokens: …` for a tiktoken-accurate
 *   pre-debit if your caps are tight.
 */
export function withBudget(opts: WithBudgetOptions): AiMiddleware {
  const pricing       = opts.pricing        ?? ModelPricing
  const tz            = opts.timezone
  const estimateTokens = opts.estimateTokens ?? defaultEstimateTokens
  const onExceeded    = opts.onExceeded     ?? defaultOnExceeded

  return {
    name: 'budget',

    async onIteration(ctx) {
      // Pre-debit fires before each model call (every step), including
      // step 1. `onIteration` runs after `onStart` but before
      // `prepareStep`/`onConfig('beforeModel')` — so transforms applied by
      // those later hooks (e.g. a `prepareStep` model swap) aren't
      // reflected in this estimate. For v1 that's acceptable; tighten
      // later if it bites.
      const userId = await opts.user(ctx)
      if (userId == null) return  // bypass — unauthenticated path or admin

      const modelKey = ctx.model
      // Fail loud if the model isn't priced — silently zero-costing through
      // a typo'd model is the worst-of-both for budget enforcement.
      const rate = assertKnownModelPricing(modelKey, pricing)

      const caps = await opts.budget({ userId, ctx })
      const definedCaps: Array<{ period: BudgetPeriod; cap: number }> = []
      if (caps.daily   != null) definedCaps.push({ period: 'daily',   cap: caps.daily })
      if (caps.monthly != null) definedCaps.push({ period: 'monthly', cap: caps.monthly })

      if (definedCaps.length === 0) return  // nothing to enforce

      // Estimate input cost for THIS step from the live messages array.
      const estimate = estimateInputCostUsd(ctx.messages, [], rate, estimateTokens)

      // Pre-debit each defined period; throw on first denial.
      for (const { period, cap } of definedCaps) {
        const r = await opts.storage.checkAndDebit({
          userId,
          period,
          cap,
          costUsd:  estimate,
          ...(tz != null ? { timezone: tz } : {}),
        })
        if (!r.allowed) {
          await onExceeded({ userId, period, spent: r.spent, cap: r.cap, ctx })
          // If onExceeded didn't throw, fall back to the default error so
          // the run is always aborted on a denied debit.
          throw new BudgetExceededError({ userId, period, spent: r.spent, cap: r.cap })
        }
      }

      // Stash for onUsage true-up. If estimate was high vs actual we just
      // accept the small over-charge; if low, onUsage debits the delta.
      ;(ctx as ContextWithBudgetState)[BudgetState] = {
        userId,
        caps: definedCaps,
        pendingEstimate: estimate,
      }
    },

    async onUsage(ctx, usage) {
      const state = (ctx as ContextWithBudgetState)[BudgetState]
      if (!state) return  // no user, was bypassed

      const modelKey = ctx.model
      const rate = pricing[modelKey]
      // If pricing was found at onConfig time it's still found here; this is
      // belt-and-suspenders for the rare case where the agent loop swapped
      // models mid-run (failover). Skip silently — the pre-debit covered
      // estimate, so we under-charge actual on a missing-rate model.
      if (!rate) {
        state.pendingEstimate = 0
        return
      }

      const actualCost = (
        usage.promptTokens     * rate.inputPer1k +
        usage.completionTokens * rate.outputPer1k
      ) / 1000

      const delta = actualCost - state.pendingEstimate
      state.pendingEstimate = 0  // clear so a tool round-trip's next onConfig starts fresh

      if (delta <= 0) return  // overestimated; accept the small over-charge

      // Always-apply true-up — the response already streamed, we can't
      // unspend. Pass MAX_SAFE_INTEGER as cap so the storage just records
      // the delta. Pre-debit enforcement already happened at onConfig.
      for (const { period } of state.caps) {
        await opts.storage.checkAndDebit({
          userId:   state.userId,
          period,
          cap:      Number.MAX_SAFE_INTEGER,
          costUsd:  delta,
          ...(tz != null ? { timezone: tz } : {}),
        })
      }
    },
  }
}

// ─── Helpers ──────────────────────────────────────────────

function defaultEstimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

function defaultOnExceeded(args: BudgetExceededArgs): never {
  throw new BudgetExceededError({
    userId: args.userId,
    period: args.period,
    spent:  args.spent,
    cap:    args.cap,
  })
}

function estimateInputCostUsd(
  messages: AiMessage[],
  systemPrompts: string[],
  rate: ModelPriceEntry,
  estimateTokens: (text: string) => number,
): number {
  // Concatenating all input into one string for the estimator means a
  // single tokenizer pass for tiktoken-backed estimators (cheaper than
  // tokenizing each message separately and summing).
  const parts: string[] = [...systemPrompts]
  for (const m of messages) parts.push(messageText(m))
  const tokens = estimateTokens(parts.join('\n'))
  return (tokens * rate.inputPer1k) / 1000
}

function messageText(m: AiMessage): string {
  if (typeof m.content === 'string') return m.content
  if (Array.isArray(m.content)) {
    let s = ''
    for (const part of m.content) s += contentPartText(part)
    return s
  }
  return ''
}

function contentPartText(p: ContentPart): string {
  return p.type === 'text' ? p.text : ''
}
