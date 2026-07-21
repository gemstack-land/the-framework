/**
 * `@gemstack/ai-sdk/computer-use` — Anthropic computer-use abstraction (#A7).
 *
 * Ships the action vocabulary, the Playwright executor, and
 * {@link computerUseTool} — the agent tool factory that maps to Anthropic's
 * native `computer_20250124` tool block and routes execution through that
 * executor.
 *
 * # Quick example (driving the executor directly)
 *
 * ```ts
 * import { chromium } from 'playwright'
 * import { executeComputerAction, makeExecutorState } from '@gemstack/ai-sdk/computer-use'
 *
 * const browser = await chromium.launch()
 * const page    = await browser.newPage()
 * await page.setViewportSize({ width: 1280, height: 800 })
 * await page.goto('https://example.com')
 *
 * const state = makeExecutorState()
 * const screen = await executeComputerAction(page, { action: 'screenshot' }, state)
 * if (screen.type === 'image') {
 *   // screen.data is a PNG Uint8Array
 * }
 *
 * await executeComputerAction(page, { action: 'left_click', coordinate: [400, 200] }, state)
 * ```
 *
 * Or let an agent drive it:
 *
 * ```ts
 * import { computerUseTool } from '@gemstack/ai-sdk/computer-use'
 *
 * class BrowserAgent extends Agent {
 *   model = 'anthropic/claude-opus-4-7'
 *   tools() { return [computerUseTool({ page })] }
 * }
 * ```
 *
 * # Anthropic-only in v1
 *
 * The action vocabulary mirrors Anthropic's `computer_20250124` schema
 * verbatim. The tool factory throws `ComputerUseProviderError` at
 * agent boot for non-Anthropic models — see plan
 * `docs/plans/2026-05-10-ai-computer-use.md`.
 */

export type {
  ComputerAction,
  ComputerActionResult,
  ComputerExecutorState,
  Coordinate,
  PageLike,
  PageMouseLike,
  PageKeyboardLike,
} from './actions.js'

export { makeExecutorState } from './actions.js'

export {
  executeComputerAction,
  parseModifiers,
  normalizeKey,
  normalizeChord,
  SCROLL_PIXELS_PER_CLICK,
  MOUSE_MOVE_STEPS,
} from './playwright.js'

// ─── Tool factory + errors (Phase 2) ──────────────────────

export type {
  ComputerUseTool,
  ComputerUseToolOptions,
} from './tool.js'

export {
  computerUseTool,
  isComputerUseTool,
  COMPUTER_USE_MARKER,
  COMPUTER_USE_TOOL_NAME,
} from './tool.js'

export {
  ComputerUseLimitError,
  ComputerUseProviderError,
  isAnthropicLikeModel,
} from './errors.js'
