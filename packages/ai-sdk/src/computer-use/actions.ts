/**
 * Action vocabulary for `@gemstack/ai-sdk/computer-use` (#A7 Phase 1).
 *
 * Mirrors Anthropic's `computer_20250124` tool schema verbatim — see
 * https://docs.anthropic.com/en/docs/build-with-claude/tool-use/computer-use-tool
 *
 * The model emits a {@link ComputerAction} as the JSON argument of a
 * `computer` tool call; the executor (see `./playwright.ts`) dispatches
 * the action against a Playwright `Page` and returns a
 * {@link ComputerActionResult} the agent loop forwards back to the model.
 *
 * # Why mirror Anthropic exactly?
 *
 * Computer-use is `Anthropic-only` in v1 (see plan
 * `docs/plans/2026-05-10-ai-computer-use.md`). Claude is fine-tuned on
 * this exact action vocabulary; reusing the schema means:
 *
 * - Phase 2's `computerUseTool({ page })` factory maps cleanly to
 *   Anthropic's native `{ type: 'computer_20250124', name: 'computer',
 *   display_width_px, display_height_px }` block — zero translation
 *   layer.
 * - When OpenAI or Google's native computer-use APIs mature enough to
 *   route through, only the provider adapter changes; the schema and
 *   executor stay put.
 *
 * # Coordinates
 *
 * `[x, y]` in viewport pixels. Origin is top-left. Anthropic suggests a
 * 1280×800 viewport for Claude's training distribution; the executor
 * does not validate bounds — out-of-viewport coordinates pass through
 * to Playwright (which clips the cursor to viewport edges).
 *
 * # Modifier text on click / scroll actions
 *
 * Anthropic encodes "hold these modifier keys while clicking" as a `+`
 * separated string on the `text` field — e.g.
 * `{ action: 'left_click', coordinate: [400, 200], text: 'shift+ctrl' }`.
 * The executor translates `cmd`/`super`/`meta` → `Meta`,
 * `ctrl`/`control` → `Control`, etc. before passing to Playwright.
 */

/** Viewport pixel coordinate, top-left origin. `[x, y]`. */
export type Coordinate = readonly [number, number]

/**
 * Discriminated union of every action Anthropic's `computer_20250124`
 * tool can emit. The executor dispatches on `action`; downstream code
 * should treat unknown variants as a forward-compatibility hazard
 * rather than a bug — Anthropic versions the schema with dated suffixes
 * (e.g. a future `computer_20260101` may add new variants we'll route
 * here once supported).
 */
export type ComputerAction =
  // ─── Screen state ─────────────────────────────────────────
  | { action: 'screenshot' }
  | { action: 'cursor_position' }

  // ─── Timing ───────────────────────────────────────────────
  /** Pause for `duration` seconds. Useful between an action that triggers async UI and the screenshot that should observe the result. */
  | { action: 'wait', duration: number }

  // ─── Pointer ──────────────────────────────────────────────
  | { action: 'mouse_move', coordinate: Coordinate }
  /** Single left-button click. `text` holds optional modifier keys, `+`-separated (e.g. `'shift+ctrl'`). */
  | { action: 'left_click', coordinate: Coordinate, text?: string }
  | { action: 'right_click', coordinate: Coordinate, text?: string }
  | { action: 'middle_click', coordinate: Coordinate, text?: string }
  | { action: 'double_click', coordinate: Coordinate, text?: string }
  | { action: 'triple_click', coordinate: Coordinate, text?: string }
  /** Press the left mouse button. Pair with `left_mouse_up` to drag. `coordinate` (optional) moves first. */
  | { action: 'left_mouse_down', coordinate?: Coordinate }
  /** Release the left mouse button. `coordinate` (optional) moves first. */
  | { action: 'left_mouse_up', coordinate?: Coordinate }

  // ─── Keyboard ─────────────────────────────────────────────
  /** Type literal text. No modifier handling — use `key` for shortcuts. */
  | { action: 'type', text: string }
  /** Press a key chord. `text` is `+`-separated (e.g. `'ctrl+a'`, `'Return'`, `'cmd+shift+t'`). */
  | { action: 'key', text: string }
  /** Hold a single key for `duration` seconds. `text` is one key, not a chord. */
  | { action: 'hold_key', text: string, duration: number }

  // ─── Scroll ───────────────────────────────────────────────
  /** Scroll at `coordinate`. `scroll_amount` is in mouse-wheel "clicks" (~100px each). `text` holds optional modifiers. */
  | {
      action: 'scroll'
      coordinate: Coordinate
      scroll_direction: 'up' | 'down' | 'left' | 'right'
      scroll_amount: number
      text?: string
    }

/**
 * Tool-result content the agent loop hands back to the model after each
 * action. Shape matches Anthropic's tool-result block content vocabulary:
 *
 * - `image` carries a PNG screenshot. The agent loop wraps this as
 *   `{ type: 'image', source: { type: 'base64', media_type, data } }`
 *   when serializing to the API.
 * - `text` carries a one-line confirmation (`"left-clicked at (400, 200)"`)
 *   or the response of an introspective action (`cursor_position`).
 * - `error` carries the failure text from a Playwright throw. Caller
 *   typically maps this onto `{ is_error: true, content: [...] }` in
 *   the tool-result block so the model knows the action failed and can
 *   retry / recover.
 */
export type ComputerActionResult =
  | { type: 'image', media_type: 'image/png', data: Uint8Array }
  | { type: 'text', text: string }
  | { type: 'error', text: string }

/**
 * Per-run state the executor mutates. Tracks the last known cursor
 * position so the `cursor_position` action can answer it (Playwright
 * has no native API to read the synthesized mouse position).
 *
 * Create one with {@link makeExecutorState} per agent run; pass the
 * same instance to every {@link executeComputerAction} call.
 */
export interface ComputerExecutorState {
  /** Last known cursor position in viewport pixels. Updated on move/click/drag. */
  cursor: { x: number; y: number }
}

/**
 * Construct a fresh {@link ComputerExecutorState}. Optional `initial`
 * seeds the cursor (defaults to `(0, 0)`).
 */
export function makeExecutorState(initial?: { x: number; y: number }): ComputerExecutorState {
  return { cursor: { x: initial?.x ?? 0, y: initial?.y ?? 0 } }
}

// ─── PageLike — structural Playwright Page subset ─────────

/**
 * Structural subset of Playwright's `Page` the executor calls. Defining
 * this here means {@link executeComputerAction} types correctly without
 * `@gemstack/ai-sdk` taking a hard dependency on the `playwright` package
 * (which carries a 300MB+ Chromium download). Apps install Playwright
 * themselves and pass `page` in.
 *
 * Any object with this shape works — real Playwright `Page`,
 * `puppeteer-core`'s `Page` (close enough), or a hand-rolled mock for
 * tests. Phase 2's `computerUseTool({ page })` accepts the same type.
 */
export interface PageLike {
  mouse: PageMouseLike
  keyboard: PageKeyboardLike
  /** Take a screenshot of the current viewport. Returns PNG bytes by default. */
  screenshot(options?: { type?: 'png' | 'jpeg' }): Promise<Uint8Array>
}

export interface PageMouseLike {
  move(x: number, y: number, options?: { steps?: number }): Promise<void>
  click(
    x: number,
    y: number,
    options?: { button?: 'left' | 'right' | 'middle'; clickCount?: number; delay?: number },
  ): Promise<void>
  down(options?: { button?: 'left' | 'right' | 'middle' }): Promise<void>
  up(options?: { button?: 'left' | 'right' | 'middle' }): Promise<void>
  wheel(deltaX: number, deltaY: number): Promise<void>
}

export interface PageKeyboardLike {
  type(text: string, options?: { delay?: number }): Promise<void>
  press(key: string, options?: { delay?: number }): Promise<void>
  down(key: string): Promise<void>
  up(key: string): Promise<void>
}
