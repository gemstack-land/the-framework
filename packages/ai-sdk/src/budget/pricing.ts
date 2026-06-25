/**
 * Model pricing catalog — USD per 1k tokens, snapshot-dated per entry.
 *
 * Used by:
 * - `@gemstack/ai-sdk/eval` to populate the cost column on eval reports
 * - `@gemstack/ai-sdk`'s budget enforcement middleware (A6 phase 3) to debit
 *   per-user spend against caps
 *
 * # Pricing drift
 *
 * Provider list pricing changes monthly. Each entry carries `_snapshotDate`
 * indicating when the rate was captured. Apps with negotiated rates should
 * pass an override map:
 *
 * ```ts
 * import { ModelPricing, withBudget } from '@gemstack/ai-sdk'
 *
 * withBudget({
 *   pricing: {
 *     ...ModelPricing,
 *     'anthropic/claude-opus-4-7': {
 *       inputPer1k:  0.012,
 *       outputPer1k: 0.060,
 *       _snapshotDate: '2026-01-15',
 *     },
 *   },
 *   // ...
 * })
 * ```
 *
 * # Cache rates
 *
 * Anthropic, OpenAI, and Google all offer reduced rates for cache reads
 * (and Anthropic charges a small premium for cache writes). The optional
 * `cacheReadPer1k` / `cacheWritePer1k` fields capture those. The budget
 * middleware uses them when `TokenUsage` carries cache deltas; when absent
 * (today's `TokenUsage` shape), input rate applies to all input tokens.
 */

/** Pricing for a single `<provider>/<model>` id, USD per 1k tokens. */
export interface ModelPriceEntry {
  /** Cost per 1k input (prompt) tokens, USD. */
  inputPer1k: number
  /** Cost per 1k output (completion) tokens, USD. */
  outputPer1k: number
  /**
   * Optional cost per 1k cached-read input tokens, USD. Set when the
   * provider exposes a discounted rate for cache hits (Anthropic ephemeral
   * cache, OpenAI prefix cache, Google cachedContent). When omitted,
   * `inputPer1k` applies to all input tokens.
   */
  cacheReadPer1k?: number
  /**
   * Optional cost per 1k cache-write input tokens, USD. Anthropic charges
   * a small premium on the first write that primes an ephemeral cache;
   * other providers don't. When omitted, `inputPer1k` applies.
   */
  cacheWritePer1k?: number
  /**
   * ISO date string indicating when this rate was captured from the
   * provider's published pricing. Surfaced in
   * {@link UnknownModelPricingError} messages and useful when auditing
   * stale catalogs.
   */
  _snapshotDate: string
}

/**
 * `<provider>/<model>` → {@link ModelPriceEntry}. Override entries by
 * spreading: `{ ...ModelPricing, 'anthropic/claude-opus-4-7': {...} }`.
 *
 * Snapshot date: 2026-05-11.
 */
export const ModelPricing: Record<string, ModelPriceEntry> = {
  // ─── Anthropic ──────────────────────────────────────────
  // Cache write = 1.25× input, cache read = 0.1× input (Anthropic ephemeral)
  'anthropic/claude-opus-4-7':       { inputPer1k: 0.015,    outputPer1k: 0.075,   cacheWritePer1k: 0.01875,   cacheReadPer1k: 0.0015,    _snapshotDate: '2026-05-11' },
  'anthropic/claude-opus-4-6':       { inputPer1k: 0.015,    outputPer1k: 0.075,   cacheWritePer1k: 0.01875,   cacheReadPer1k: 0.0015,    _snapshotDate: '2026-05-11' },
  'anthropic/claude-sonnet-4-6':     { inputPer1k: 0.003,    outputPer1k: 0.015,   cacheWritePer1k: 0.00375,   cacheReadPer1k: 0.0003,    _snapshotDate: '2026-05-11' },
  'anthropic/claude-sonnet-4-5':     { inputPer1k: 0.003,    outputPer1k: 0.015,   cacheWritePer1k: 0.00375,   cacheReadPer1k: 0.0003,    _snapshotDate: '2026-05-11' },
  'anthropic/claude-haiku-4-5':      { inputPer1k: 0.0008,   outputPer1k: 0.004,   cacheWritePer1k: 0.001,     cacheReadPer1k: 0.00008,   _snapshotDate: '2026-05-11' },
  'anthropic/claude-3-7-sonnet':     { inputPer1k: 0.003,    outputPer1k: 0.015,   cacheWritePer1k: 0.00375,   cacheReadPer1k: 0.0003,    _snapshotDate: '2026-05-11' },
  'anthropic/claude-3-5-sonnet':     { inputPer1k: 0.003,    outputPer1k: 0.015,   cacheWritePer1k: 0.00375,   cacheReadPer1k: 0.0003,    _snapshotDate: '2026-05-11' },
  'anthropic/claude-3-5-haiku':      { inputPer1k: 0.0008,   outputPer1k: 0.004,   cacheWritePer1k: 0.001,     cacheReadPer1k: 0.00008,   _snapshotDate: '2026-05-11' },

  // ─── OpenAI ─────────────────────────────────────────────
  // Cache read = 0.5× input (OpenAI prefix cache); no cache write surcharge
  'openai/gpt-4-1':                  { inputPer1k: 0.002,    outputPer1k: 0.008,   cacheReadPer1k: 0.0005,    _snapshotDate: '2026-05-11' },
  'openai/gpt-4-1-mini':             { inputPer1k: 0.0004,   outputPer1k: 0.0016,  cacheReadPer1k: 0.0001,    _snapshotDate: '2026-05-11' },
  'openai/gpt-4-1-nano':             { inputPer1k: 0.0001,   outputPer1k: 0.0004,  cacheReadPer1k: 0.000025,  _snapshotDate: '2026-05-11' },
  'openai/gpt-4o':                   { inputPer1k: 0.0025,   outputPer1k: 0.01,    cacheReadPer1k: 0.00125,   _snapshotDate: '2026-05-11' },
  'openai/gpt-4o-mini':              { inputPer1k: 0.00015,  outputPer1k: 0.0006,  cacheReadPer1k: 0.000075,  _snapshotDate: '2026-05-11' },
  'openai/o1':                       { inputPer1k: 0.015,    outputPer1k: 0.06,    cacheReadPer1k: 0.0075,    _snapshotDate: '2026-05-11' },
  'openai/o1-mini':                  { inputPer1k: 0.0011,   outputPer1k: 0.0044,  cacheReadPer1k: 0.00055,   _snapshotDate: '2026-05-11' },
  'openai/o3':                       { inputPer1k: 0.002,    outputPer1k: 0.008,   cacheReadPer1k: 0.0005,    _snapshotDate: '2026-05-11' },
  'openai/o3-mini':                  { inputPer1k: 0.0011,   outputPer1k: 0.0044,  cacheReadPer1k: 0.00055,   _snapshotDate: '2026-05-11' },
  'openai/o4-mini':                  { inputPer1k: 0.0011,   outputPer1k: 0.0044,  cacheReadPer1k: 0.000275,  _snapshotDate: '2026-05-11' },

  // ─── Google (Gemini) ────────────────────────────────────
  // Cache read = 0.25× input (Google cachedContent); no cache write surcharge
  'google/gemini-2.5-pro':           { inputPer1k: 0.00125,  outputPer1k: 0.005,   cacheReadPer1k: 0.0003125, _snapshotDate: '2026-05-11' },
  'google/gemini-2.5-flash':         { inputPer1k: 0.000075, outputPer1k: 0.0003,  cacheReadPer1k: 0.00001875,_snapshotDate: '2026-05-11' },
  'google/gemini-2.5-flash-lite':    { inputPer1k: 0.00004,  outputPer1k: 0.00015, cacheReadPer1k: 0.00001,   _snapshotDate: '2026-05-11' },
  'google/gemini-2.0-flash':         { inputPer1k: 0.0001,   outputPer1k: 0.0004,  cacheReadPer1k: 0.000025,  _snapshotDate: '2026-05-11' },
  'google/gemini-2.0-flash-lite':    { inputPer1k: 0.000075, outputPer1k: 0.0003,  cacheReadPer1k: 0.00001875,_snapshotDate: '2026-05-11' },

  // ─── Bedrock (Anthropic models on AWS Bedrock) ──────────
  // Bedrock matches Anthropic list pricing for Claude family.
  'bedrock/anthropic.claude-opus-4-7':       { inputPer1k: 0.015,  outputPer1k: 0.075, cacheWritePer1k: 0.01875, cacheReadPer1k: 0.0015,  _snapshotDate: '2026-05-11' },
  'bedrock/anthropic.claude-sonnet-4-6':     { inputPer1k: 0.003,  outputPer1k: 0.015, cacheWritePer1k: 0.00375, cacheReadPer1k: 0.0003,  _snapshotDate: '2026-05-11' },
  'bedrock/anthropic.claude-haiku-4-5':      { inputPer1k: 0.0008, outputPer1k: 0.004, cacheWritePer1k: 0.001,   cacheReadPer1k: 0.00008, _snapshotDate: '2026-05-11' },
  'bedrock/anthropic.claude-3-5-sonnet':     { inputPer1k: 0.003,  outputPer1k: 0.015, cacheWritePer1k: 0.00375, cacheReadPer1k: 0.0003,  _snapshotDate: '2026-05-11' },
  'bedrock/anthropic.claude-3-5-haiku':      { inputPer1k: 0.0008, outputPer1k: 0.004, cacheWritePer1k: 0.001,   cacheReadPer1k: 0.00008, _snapshotDate: '2026-05-11' },

  // ─── xAI (Grok) ─────────────────────────────────────────
  'xai/grok-4':                      { inputPer1k: 0.003,    outputPer1k: 0.015,   _snapshotDate: '2026-05-11' },
  'xai/grok-3':                      { inputPer1k: 0.003,    outputPer1k: 0.015,   _snapshotDate: '2026-05-11' },
  'xai/grok-3-mini':                 { inputPer1k: 0.0003,   outputPer1k: 0.0005,  _snapshotDate: '2026-05-11' },

  // ─── DeepSeek ───────────────────────────────────────────
  'deepseek/deepseek-chat':          { inputPer1k: 0.00027,  outputPer1k: 0.0011,  cacheReadPer1k: 0.00007,   _snapshotDate: '2026-05-11' },
  'deepseek/deepseek-reasoner':      { inputPer1k: 0.00055,  outputPer1k: 0.00219, cacheReadPer1k: 0.00014,   _snapshotDate: '2026-05-11' },

  // ─── Mistral ────────────────────────────────────────────
  'mistral/mistral-large':           { inputPer1k: 0.002,    outputPer1k: 0.006,   _snapshotDate: '2026-05-11' },
  'mistral/mistral-medium':          { inputPer1k: 0.0004,   outputPer1k: 0.002,   _snapshotDate: '2026-05-11' },
  'mistral/mistral-small':           { inputPer1k: 0.0001,   outputPer1k: 0.0003,  _snapshotDate: '2026-05-11' },

  // ─── Groq ───────────────────────────────────────────────
  'groq/llama-3.3-70b-versatile':    { inputPer1k: 0.00059,  outputPer1k: 0.00079, _snapshotDate: '2026-05-11' },
  'groq/llama-3.1-8b-instant':       { inputPer1k: 0.00005,  outputPer1k: 0.00008, _snapshotDate: '2026-05-11' },

  // ─── Cohere ─────────────────────────────────────────────
  'cohere/command-a':                { inputPer1k: 0.0025,   outputPer1k: 0.01,    _snapshotDate: '2026-05-11' },
  'cohere/command-r-plus':           { inputPer1k: 0.0025,   outputPer1k: 0.01,    _snapshotDate: '2026-05-11' },
  'cohere/command-r':                { inputPer1k: 0.00015,  outputPer1k: 0.0006,  _snapshotDate: '2026-05-11' },
}

/**
 * Compute USD cost for an agent call given prompt + completion token
 * counts and a pricing catalog.
 *
 * Returns `0` when the model id isn't in `pricing` — eval cost columns
 * shouldn't crash on a fresh model. The budget middleware (A6 phase 3)
 * uses {@link assertKnownModelPricing} to fail loud at config time
 * instead.
 *
 * @param model     `<provider>/<model>` id
 * @param promptTokens  Input tokens charged at `inputPer1k`
 * @param completionTokens  Output tokens charged at `outputPer1k`
 * @param pricing   Catalog override (defaults to {@link ModelPricing})
 */
export function estimateCost(
  model: string,
  promptTokens: number,
  completionTokens: number,
  pricing: Record<string, ModelPriceEntry> = ModelPricing,
): number {
  const rate = pricing[model]
  if (!rate) return 0
  return (promptTokens * rate.inputPer1k + completionTokens * rate.outputPer1k) / 1000
}

/**
 * Budget enforcement uses this — fail loud at agent-construction time
 * if the configured model isn't priced. Call from `withBudget(...)` in
 * phase 3.
 *
 * @throws {UnknownModelPricingError} when `pricing[model]` is missing
 */
export function assertKnownModelPricing(
  model: string,
  pricing: Record<string, ModelPriceEntry> = ModelPricing,
): ModelPriceEntry {
  const rate = pricing[model]
  if (!rate) throw new UnknownModelPricingError(model, pricing)
  return rate
}

/**
 * Thrown by `assertKnownModelPricing` when a model id has no pricing
 * entry. The budget middleware throws this at construction so apps
 * fail at boot, not on first prompt.
 */
export class UnknownModelPricingError extends Error {
  readonly model: string
  readonly snapshotDate: string | null

  constructor(model: string, pricing: Record<string, ModelPriceEntry>) {
    const sample = Object.keys(pricing)[0]
    const snapshotDate = sample ? (pricing[sample]?._snapshotDate ?? null) : null
    const sampleSuffix = snapshotDate ? ` (catalog snapshot ${snapshotDate})` : ''
    super(
      `[Rudder AI] No pricing entry for model "${model}"${sampleSuffix}. ` +
      `Either the model id is misspelled, or the catalog is stale — ` +
      `add an override entry: \`pricing: { ...ModelPricing, "${model}": { inputPer1k, outputPer1k, _snapshotDate } }\`.`,
    )
    this.name = 'UnknownModelPricingError'
    this.model = model
    this.snapshotDate = snapshotDate
  }
}

/**
 * Thrown by the budget middleware (A6 phase 3) when a request would
 * exceed a user's daily or monthly cap. Apps that want a different
 * error type can intercept via `withBudget({ onExceeded })` and throw
 * their own.
 */
export class BudgetExceededError extends Error {
  readonly userId: string
  readonly period: 'daily' | 'monthly'
  readonly spent: number
  readonly cap: number

  constructor(opts: { userId: string; period: 'daily' | 'monthly'; spent: number; cap: number }) {
    super(
      `[Rudder AI] ${opts.period} budget of $${opts.cap.toFixed(2)} exceeded for user ${opts.userId} ` +
      `(spent $${opts.spent.toFixed(4)}).`,
    )
    this.name = 'BudgetExceededError'
    this.userId = opts.userId
    this.period = opts.period
    this.spent = opts.spent
    this.cap = opts.cap
  }
}
