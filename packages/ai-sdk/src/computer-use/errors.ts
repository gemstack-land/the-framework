/**
 * Error classes for `@gemstack/ai-sdk/computer-use` (#A7 Phase 2).
 *
 * Both extend native `Error` so apps can `instanceof`-check from
 * `try/catch`, error middleware, observers, etc.
 */

/**
 * Thrown by {@link computerUseTool} at construction time when the
 * caller supplies a `model` that isn't an Anthropic-family model
 * (matches `anthropic/*` or `bedrock/<region.>?anthropic.*`).
 *
 * Computer-use is Anthropic-only in v1 — see plan
 * `docs/plans/2026-05-10-ai-computer-use.md`. Other providers either
 * lack native computer-use entirely (Google, Cohere, …) or only have
 * preview-quality versions that aren't worth shipping yet (OpenAI's
 * `computer_use_preview`).
 *
 * Apps that wire `computerUseTool({ page, model: this.model() })`
 * inside `Agent.tools()` get this error at agent boot — fail loud
 * before the model gets a chance to hallucinate tool calls against a
 * provider that can't execute them.
 */
export class ComputerUseProviderError extends Error {
  readonly code = 'COMPUTER_USE_PROVIDER_MISMATCH' as const
  readonly model: string

  constructor(model: string) {
    super(
      `[ai-sdk] computerUseTool is Anthropic-only in v1; got model "${model}". ` +
      `Use an "anthropic/*" or "bedrock/<region.>?anthropic.*" model, or remove the tool.`,
    )
    this.name = 'ComputerUseProviderError'
    this.model = model
  }
}

/**
 * Thrown by {@link computerUseTool}'s execute when the per-run action
 * counter exceeds {@link ComputerUseToolOptions.maxActions}.
 *
 * Bounds runaway agent loops (e.g. a model that keeps clicking the
 * same broken button forever). Default cap is 50 — most real
 * computer-use tasks finish well under that. Override via
 * `computerUseTool({ page, maxActions: 100 })`.
 */
export class ComputerUseLimitError extends Error {
  readonly code = 'COMPUTER_USE_LIMIT_EXCEEDED' as const
  readonly maxActions: number

  constructor(maxActions: number) {
    super(
      `[ai-sdk] computerUseTool exceeded maxActions cap of ${maxActions}. ` +
      `Bump the cap with computerUseTool({ page, maxActions: <n> }) if your agent legitimately needs more steps.`,
    )
    this.name = 'ComputerUseLimitError'
    this.maxActions = maxActions
  }
}

// ─── Model classification ─────────────────────────────────

/**
 * Returns true when `model` is an Anthropic-family model id —
 * `anthropic/*` or `bedrock/<region.>?anthropic.*` (covers cross-region
 * inference profiles like `us.anthropic.*`, `eu.anthropic.*`,
 * `apac.anthropic.*`).
 *
 * Used by {@link computerUseTool}'s upfront `model` check. Exported so
 * apps can guard their own code path symmetrically.
 *
 * **Excludes** OpenRouter-routed Anthropic models
 * (`openrouter/anthropic/*`) — OpenRouter goes through the OpenAI SDK
 * with a different base URL, so the request never hits Anthropic's
 * native API and the native computer-use tool block can't be sent.
 */
export function isAnthropicLikeModel(model: string): boolean {
  if (model.startsWith('anthropic/')) return true
  // Bedrock: bedrock/anthropic.* OR bedrock/<region>.anthropic.*
  // (region prefixes us./eu./apac./...)
  if (/^bedrock\/(?:[a-z]{2,4}\.)?anthropic\./.test(model)) return true
  return false
}
