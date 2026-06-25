/**
 * `computerUseTool({ page })` — the agent-tool factory for #A7 Phase 2.
 *
 * Wraps the phase-1 {@link executeComputerAction} executor as a tool the
 * agent loop can invoke. The tool is tagged so the Anthropic provider
 * adapter substitutes the standard function-call schema with Anthropic's
 * native `computer_20250124` tool block at the API level — Claude is
 * fine-tuned on that exact tool, so quality is dramatically better than
 * a generic function-call wrapper.
 *
 * # Anthropic-only in v1
 *
 * Pass `model` to fail loud at agent-construction time when the agent's
 * model isn't Anthropic-family — see {@link ComputerUseProviderError}.
 * Without `model`, validation is deferred (the Anthropic adapter is the
 * only one that recognizes the provider hint, so non-Anthropic models
 * silently see a no-arg generic tool — degraded but not catastrophic).
 *
 * # Wiring
 *
 * ```ts
 * import { Agent } from '@gemstack/ai-sdk'
 * import { computerUseTool } from '@gemstack/ai-sdk/computer-use'
 * import { chromium } from 'playwright'
 *
 * const browser = await chromium.launch()
 * const page    = await browser.newPage()
 * await page.setViewportSize({ width: 1280, height: 800 })
 *
 * class BrowserAgent extends Agent {
 *   model() { return 'anthropic/claude-opus-4-7' }
 *
 *   tools() {
 *     return [
 *       computerUseTool({
 *         page,
 *         viewport: { width: 1280, height: 800 },
 *         model:    this.model(),   // upfront provider check
 *       }),
 *     ]
 *   }
 * }
 * ```
 *
 * # State
 *
 * Each `computerUseTool({...})` call captures a fresh
 * {@link ComputerExecutorState} in its closure. Passing the same tool
 * instance through multiple agent runs SHARES cursor state across them
 * — usually fine, but call the factory inside `tools()` (which Agent
 * runs per request) for clean per-run state.
 *
 * The same closure carries the action counter for {@link maxActions}.
 *
 * # Image results
 *
 * `screenshot` actions return PNG bytes. The tool's execute base64-
 * encodes them and returns a `ContentPart[]` array with one image
 * block — the Anthropic adapter's `toAnthropicMessages` handles array
 * tool-message content directly (a generic enhancement, not
 * computer-use-specific). Other providers see a JSON-stringified
 * fallback; in practice they never get here because the tool throws at
 * construction when bound to a non-Anthropic model.
 */

import { z } from 'zod'

import type { ContentPart, Tool, ToolCallContext, ToolDefinitionOptions, ToolDefinitionSchema } from '../types.js'

import {
  ComputerUseLimitError,
  ComputerUseProviderError,
  isAnthropicLikeModel,
} from './errors.js'
import {
  makeExecutorState,
  type ComputerAction,
  type ComputerActionResult,
  type ComputerExecutorState,
  type PageLike,
} from './actions.js'
import { executeComputerAction } from './playwright.js'

/**
 * Symbol-tagged marker identifying a computer-use tool. Looked up via
 * `Symbol.for(...)` so cross-bundle / cross-realm checks succeed even
 * when `@gemstack/ai-sdk` is loaded twice (rare, but possible in monorepo +
 * linked setups). Mirrors the `HANDOFF_MARKER` pattern.
 */
export const COMPUTER_USE_MARKER: unique symbol = Symbol.for('rudderjs.ai.computer-use')

/**
 * The fixed tool name. Anthropic's native `computer_20250124` tool
 * expects calls to land on a tool literally named `computer` — the
 * model is trained on that name. Apps don't override it.
 */
export const COMPUTER_USE_TOOL_NAME = 'computer'

const DEFAULT_VIEWPORT = { width: 1280, height: 800 } as const
const DEFAULT_MAX_ACTIONS = 50
const DEFAULT_NEEDS_APPROVAL: boolean | ((action: ComputerAction) => boolean) = true

/** Options for {@link computerUseTool}. */
export interface ComputerUseToolOptions {
  /**
   * Playwright `Page` (or any object structurally matching {@link PageLike}).
   * Caller owns the lifecycle — launch, set viewport, navigate, close.
   */
  page: PageLike
  /**
   * Display dimensions reported to the model in the native
   * `computer_20250124` block. Defaults to `1280×800` (Anthropic's
   * recommended training-distribution size). Must match what
   * `page.setViewportSize(...)` was called with — Claude grounds clicks
   * in this coordinate space.
   */
  viewport?: { width: number; height: number }
  /**
   * Optional agent model id. When provided, the factory fails loud at
   * construction time if the model isn't Anthropic-family — see
   * {@link ComputerUseProviderError}. Pass `this.model()` from inside
   * `Agent.tools()` to get the check.
   */
  model?: string
  /**
   * Per-action approval gate. `true` (default) routes every action
   * through the framework's approval middleware before execution.
   * `false` opts out entirely. Function form decides per-action — useful
   * for letting cheap actions (`screenshot`, `mouse_move`) run
   * unattended while gating destructive ones.
   *
   * Wired via {@link ToolDefinitionOptions.requireApproval} — same
   * channel the rest of `@gemstack/ai-sdk`'s approval-resume machinery uses.
   */
  needsApproval?: boolean | ((action: ComputerAction) => boolean)
  /**
   * Maximum number of actions per agent run before
   * {@link ComputerUseLimitError} is thrown. Default `50`. Bounds
   * runaway loops where the model keeps trying the same broken UI step.
   */
  maxActions?: number
  /**
   * Override the per-run cursor-tracking state. Rarely needed — the
   * factory creates a fresh state by default. Provide one if you want
   * to seed the cursor (e.g. resuming a paused session).
   */
  state?: ComputerExecutorState
}

/**
 * The tool returned by {@link computerUseTool}. Implements the
 * {@link Tool} interface with `execute` (so the agent loop runs it
 * directly), and carries the {@link COMPUTER_USE_MARKER} so adapters
 * and observers can detect it without coupling to a class.
 */
export interface ComputerUseTool extends Tool<ComputerAction, ContentPart[] | string> {
  readonly [COMPUTER_USE_MARKER]: true
  readonly definition: ToolDefinitionOptions
  execute(input: ComputerAction, ctx?: ToolCallContext): Promise<ContentPart[] | string>
  toSchema(): ToolDefinitionSchema
}

/**
 * Build the agent tool. See module JSDoc for usage.
 */
export function computerUseTool(opts: ComputerUseToolOptions): ComputerUseTool {
  // Upfront provider check — fail loud at agent construction.
  if (opts.model !== undefined && !isAnthropicLikeModel(opts.model)) {
    throw new ComputerUseProviderError(opts.model)
  }

  const viewport       = opts.viewport      ?? DEFAULT_VIEWPORT
  const maxActions     = opts.maxActions    ?? DEFAULT_MAX_ACTIONS
  const needsApproval  = opts.needsApproval ?? DEFAULT_NEEDS_APPROVAL
  const state          = opts.state         ?? makeExecutorState()
  const page           = opts.page

  // Per-tool-instance counter. Closure-private so multiple tools (rare)
  // don't collide.
  const counter = { value: 0 }

  // Build the needs-approval shape the framework's tool runner reads.
  // ToolDefinitionOptions.needsApproval is `boolean | (input) => boolean | Promise<boolean>`.
  const needsApprovalForDefinition: boolean | ((input: ComputerAction) => boolean) =
    typeof needsApproval === 'function'
      ? (input) => (needsApproval as (a: ComputerAction) => boolean)(input)
      : needsApproval

  const definition: ToolDefinitionOptions = {
    name:        COMPUTER_USE_TOOL_NAME,
    description:
      'Take screenshots, click, type, and otherwise drive a desktop / browser. ' +
      'Use to interact with on-screen UI you cannot reach via plain HTTP.',
    // Anthropic's native tool block carries an implicit schema (the model
    // is trained on it). The standard `parameters` we emit is irrelevant
    // for Anthropic — the providerHint substitution drops it. `z.any()`
    // is the conservative default for any non-Anthropic serialization
    // that still tries to read the schema.
    inputSchema:   z.any(),
    needsApproval: needsApprovalForDefinition as ToolDefinitionOptions['needsApproval'],
    // Carried through by `toolToSchema` → `toAnthropicTools` recognizes
    // `providerHint.type === 'computer-use'` and emits the native
    // `computer_20250124` block instead of a generic function-call shape.
    providerHint: {
      type:              'computer-use',
      tool:              'computer_20250124',
      display_width_px:  viewport.width,
      display_height_px: viewport.height,
    },
  }

  const tool: ComputerUseTool = {
    [COMPUTER_USE_MARKER]: true,
    definition,
    async execute(input: ComputerAction): Promise<ContentPart[] | string> {
      counter.value++
      if (counter.value > maxActions) {
        throw new ComputerUseLimitError(maxActions)
      }

      const result = await executeComputerAction(page, input, state)
      return formatActionResult(result)
    },
    toSchema(): ToolDefinitionSchema {
      return {
        name:        COMPUTER_USE_TOOL_NAME,
        description: definition.description,
        // Empty object — see comment in `definition.inputSchema` above.
        parameters:  { type: 'object', properties: {}, additionalProperties: true },
        providerHint: definition.providerHint!,
      }
    },
  }

  return tool
}

/**
 * Convert a {@link ComputerActionResult} into the message-content shape
 * the agent loop stores on the tool message and passes to the provider.
 *
 * - `image` → `ContentPart[]` with one image block. The Anthropic
 *   adapter's tool-message handler emits this as Anthropic's `content:
 *   [{ type: 'image', source: { ... } }]` shape.
 * - `text` → plain string (current adapter path: `content: <string>`).
 * - `error` → throw. The agent loop's error path wraps the throw into a
 *   tool-result with `is_error: true` and the error message — exactly
 *   the Anthropic semantics we want for "the action failed; let the
 *   model retry."
 */
function formatActionResult(result: ComputerActionResult): ContentPart[] | string {
  if (result.type === 'image') {
    const data = bytesToBase64(result.data)
    return [
      {
        type:     'image',
        mimeType: result.media_type,
        data,
      },
    ]
  }
  if (result.type === 'text') {
    return result.text
  }
  // result.type === 'error' — throw so the agent loop wraps as is_error.
  throw new Error(result.text)
}

/**
 * Encode raw bytes as a base64 string. Uses `Buffer` when available
 * (Node) and falls back to a synchronous browser-safe path otherwise.
 * Computer-use only runs in Node (Playwright requires it), but the
 * fallback keeps the module importable from runtime-agnostic tests.
 */
function bytesToBase64(data: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(data).toString('base64')
  }
  // Browser fallback — slow but correct.
  let binary = ''
  for (let i = 0; i < data.length; i++) binary += String.fromCharCode(data[i] as number)
  return btoa(binary)
}

/**
 * Structural typeguard. Mirrors {@link isHandoffTool} — handoff /
 * computer-use tools are plain objects tagged with their respective
 * `Symbol.for(...)` markers, so the loop and adapters can detect them
 * without coupling to a class hierarchy.
 */
export function isComputerUseTool(t: unknown): t is ComputerUseTool {
  if (t === null || typeof t !== 'object') return false
  const marker = (t as Record<string | symbol, unknown>)[COMPUTER_USE_MARKER]
  return marker === true
}

// ─── Re-export error classes + helper ─────────────────────

export { ComputerUseLimitError, ComputerUseProviderError, isAnthropicLikeModel }
