/**
 * Playwright executor for {@link ComputerAction} (#A7 Phase 1).
 *
 * Translates Anthropic's `computer_20250124` action vocabulary into
 * Playwright `Page` calls. Stateless apart from {@link ComputerExecutorState},
 * which the caller threads through so `cursor_position` can answer.
 *
 * # Errors
 *
 * Playwright throws on failures (selector misses, timeouts, navigation
 * during action). The executor catches and returns
 * `{ type: 'error', text: <message> }` so the agent loop can hand the
 * failure back to the model as a tool-result with `is_error: true`. The
 * model decides whether to retry, recover, or give up — failing the
 * whole agent run on a single missed click is too brittle.
 *
 * # Modifier keys & key chords
 *
 * Anthropic uses xdotool naming (`ctrl`, `cmd`, `Return`); Playwright
 * uses its own (`Control`, `Meta`, `Enter`). {@link normalizeKey} maps
 * the common ones; unmapped keys pass through verbatim and Playwright
 * either accepts them (single chars, function keys) or throws — which
 * surfaces as the standard error path above.
 *
 * # Scroll units
 *
 * Anthropic's `scroll_amount` is in mouse-wheel "clicks". A typical
 * desktop wheel click is ~100px; the executor multiplies through
 * {@link SCROLL_PIXELS_PER_CLICK}. Tunable later if customer feedback
 * shows drift.
 */

import type {
  ComputerAction,
  ComputerActionResult,
  ComputerExecutorState,
  PageLike,
} from './actions.js'

/**
 * Pixels per `scroll_amount` unit. Roughly matches a desktop mouse
 * wheel click on most platforms.
 */
export const SCROLL_PIXELS_PER_CLICK = 100

/**
 * Number of intermediate move steps Playwright interpolates when the
 * executor moves the mouse to a target. Higher = smoother (more hover
 * events fire), but slower. 5 is a reasonable default — instant enough
 * for most pages, slow enough that hover-driven UI (tooltips, menus)
 * has a chance to react.
 */
export const MOUSE_MOVE_STEPS = 5

/**
 * Dispatch a single {@link ComputerAction} against a Playwright `Page`.
 *
 * Updates `state.cursor` after every action that targets a coordinate
 * (move / click / drag / scroll). Caller owns `state` and threads it
 * through every call within an agent run.
 *
 * Returns a {@link ComputerActionResult} suitable for forwarding to the
 * model as a tool-result. Never throws — Playwright failures surface as
 * `{ type: 'error', text }`.
 */
export async function executeComputerAction(
  page: PageLike,
  action: ComputerAction,
  state: ComputerExecutorState,
): Promise<ComputerActionResult> {
  try {
    switch (action.action) {
      case 'screenshot': {
        const data = await page.screenshot({ type: 'png' })
        return { type: 'image', media_type: 'image/png', data }
      }

      case 'cursor_position': {
        return { type: 'text', text: `X=${state.cursor.x}, Y=${state.cursor.y}` }
      }

      case 'wait': {
        await sleep(action.duration * 1000)
        return { type: 'text', text: `waited ${action.duration}s` }
      }

      case 'mouse_move': {
        const [x, y] = action.coordinate
        await page.mouse.move(x, y, { steps: MOUSE_MOVE_STEPS })
        state.cursor = { x, y }
        return { type: 'text', text: `moved to (${x}, ${y})` }
      }

      case 'left_click':
      case 'right_click':
      case 'middle_click': {
        const button = action.action === 'left_click'
          ? 'left'
          : action.action === 'right_click'
          ? 'right'
          : 'middle'
        const [x, y] = action.coordinate
        const modifiers = parseModifiers(action.text)
        await pressDown(page, modifiers)
        try {
          await page.mouse.move(x, y, { steps: MOUSE_MOVE_STEPS })
          await page.mouse.click(x, y, { button })
        } finally {
          await pressUp(page, modifiers)
        }
        state.cursor = { x, y }
        return { type: 'text', text: `${button}-clicked at (${x}, ${y})` }
      }

      case 'double_click':
      case 'triple_click': {
        const clickCount = action.action === 'double_click' ? 2 : 3
        const label     = action.action === 'double_click' ? 'double' : 'triple'
        const [x, y] = action.coordinate
        const modifiers = parseModifiers(action.text)
        await pressDown(page, modifiers)
        try {
          await page.mouse.move(x, y, { steps: MOUSE_MOVE_STEPS })
          await page.mouse.click(x, y, { button: 'left', clickCount })
        } finally {
          await pressUp(page, modifiers)
        }
        state.cursor = { x, y }
        return { type: 'text', text: `${label}-clicked at (${x}, ${y})` }
      }

      case 'left_mouse_down': {
        if (action.coordinate) {
          const [x, y] = action.coordinate
          await page.mouse.move(x, y, { steps: MOUSE_MOVE_STEPS })
          state.cursor = { x, y }
        }
        await page.mouse.down({ button: 'left' })
        return { type: 'text', text: `mouse down at (${state.cursor.x}, ${state.cursor.y})` }
      }

      case 'left_mouse_up': {
        if (action.coordinate) {
          const [x, y] = action.coordinate
          await page.mouse.move(x, y, { steps: MOUSE_MOVE_STEPS })
          state.cursor = { x, y }
        }
        await page.mouse.up({ button: 'left' })
        return { type: 'text', text: `mouse up at (${state.cursor.x}, ${state.cursor.y})` }
      }

      case 'type': {
        await page.keyboard.type(action.text)
        return { type: 'text', text: `typed ${JSON.stringify(action.text)}` }
      }

      case 'key': {
        await page.keyboard.press(normalizeChord(action.text))
        return { type: 'text', text: `pressed ${action.text}` }
      }

      case 'hold_key': {
        const key = normalizeKey(action.text)
        await page.keyboard.down(key)
        try {
          await sleep(action.duration * 1000)
        } finally {
          await page.keyboard.up(key)
        }
        return { type: 'text', text: `held ${action.text} for ${action.duration}s` }
      }

      case 'scroll': {
        const [x, y] = action.coordinate
        const modifiers = parseModifiers(action.text)
        await pressDown(page, modifiers)
        try {
          await page.mouse.move(x, y, { steps: MOUSE_MOVE_STEPS })
          const px = action.scroll_amount * SCROLL_PIXELS_PER_CLICK
          let dx = 0
          let dy = 0
          switch (action.scroll_direction) {
            case 'up':    dy = -px; break
            case 'down':  dy = px;  break
            case 'left':  dx = -px; break
            case 'right': dx = px;  break
          }
          await page.mouse.wheel(dx, dy)
        } finally {
          await pressUp(page, modifiers)
        }
        state.cursor = { x, y }
        return {
          type: 'text',
          text: `scrolled ${action.scroll_direction} ${action.scroll_amount} clicks at (${x}, ${y})`,
        }
      }

      default: {
        // Exhaustiveness guard — TS errors if a future action variant is
        // added to ComputerAction without a handler here.
        const _exhaustive: never = action
        throw new Error(`Unknown computer action: ${JSON.stringify(_exhaustive)}`)
      }
    }
  } catch (err) {
    const text = err instanceof Error ? err.message : String(err)
    return { type: 'error', text }
  }
}

// ─── Helpers ──────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Parse Anthropic's `+`-separated modifier text into Playwright key
 * names. Empty / undefined input → empty array (no modifiers).
 */
export function parseModifiers(text: string | undefined): string[] {
  if (!text) return []
  return text
    .split('+')
    .map((s) => normalizeKey(s.trim()))
    .filter(Boolean)
}

/**
 * Map Anthropic / xdotool key names to Playwright key names.
 * Unmapped keys (single chars, F-keys, anything we haven't covered)
 * pass through verbatim — Playwright either accepts them or throws,
 * which is the right failure mode.
 */
export function normalizeKey(key: string): string {
  switch (key.toLowerCase()) {
    case 'ctrl':
    case 'control':   return 'Control'
    case 'shift':     return 'Shift'
    case 'alt':       return 'Alt'
    case 'cmd':
    case 'super':
    case 'meta':      return 'Meta'
    case 'return':
    case 'enter':     return 'Enter'
    case 'tab':       return 'Tab'
    case 'space':     return 'Space'
    case 'escape':
    case 'esc':       return 'Escape'
    case 'backspace': return 'Backspace'
    case 'delete':
    case 'del':       return 'Delete'
    case 'up':        return 'ArrowUp'
    case 'down':      return 'ArrowDown'
    case 'left':      return 'ArrowLeft'
    case 'right':     return 'ArrowRight'
    case 'page_up':
    case 'pageup':    return 'PageUp'
    case 'page_down':
    case 'pagedown':  return 'PageDown'
    case 'home':      return 'Home'
    case 'end':       return 'End'
    default:          return key
  }
}

/**
 * Normalize a key chord (`+`-separated). Playwright's
 * `keyboard.press()` parses chords natively, so we just normalize each
 * segment and rejoin.
 */
export function normalizeChord(chord: string): string {
  return chord
    .split('+')
    .map((s) => normalizeKey(s.trim()))
    .join('+')
}

async function pressDown(page: PageLike, keys: string[]): Promise<void> {
  for (const k of keys) await page.keyboard.down(k)
}

async function pressUp(page: PageLike, keys: string[]): Promise<void> {
  for (const k of [...keys].reverse()) await page.keyboard.up(k)
}
