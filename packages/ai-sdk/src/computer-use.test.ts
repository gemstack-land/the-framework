import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  executeComputerAction,
  makeExecutorState,
  normalizeChord,
  normalizeKey,
  parseModifiers,
  SCROLL_PIXELS_PER_CLICK,
  type ComputerAction,
  type PageLike,
} from './computer-use/index.js'

// ─── Mock PageLike ────────────────────────────────────────

type Call = { method: string; args: unknown[] }

function makeMockPage(opts: { screenshotBytes?: Uint8Array; throwOn?: string } = {}): {
  page: PageLike
  calls: Call[]
} {
  const calls: Call[] = []
  const record = (method: string, args: unknown[]): void => {
    calls.push({ method, args })
  }
  const screenshotBytes = opts.screenshotBytes ?? new Uint8Array([0x89, 0x50, 0x4e, 0x47])

  const page: PageLike = {
    mouse: {
      async move(x, y, options) {
        record('mouse.move', [x, y, options])
        if (opts.throwOn === 'mouse.move') throw new Error('boom in move')
      },
      async click(x, y, options) {
        record('mouse.click', [x, y, options])
        if (opts.throwOn === 'mouse.click') throw new Error('boom in click')
      },
      async down(options) {
        record('mouse.down', [options])
      },
      async up(options) {
        record('mouse.up', [options])
      },
      async wheel(dx, dy) {
        record('mouse.wheel', [dx, dy])
      },
    },
    keyboard: {
      async type(text, options) {
        record('keyboard.type', [text, options])
      },
      async press(key, options) {
        record('keyboard.press', [key, options])
      },
      async down(key) {
        record('keyboard.down', [key])
      },
      async up(key) {
        record('keyboard.up', [key])
      },
    },
    async screenshot(options) {
      record('screenshot', [options])
      if (opts.throwOn === 'screenshot') throw new Error('boom in screenshot')
      return screenshotBytes
    },
  }
  return { page, calls }
}

// ─── normalizeKey + normalizeChord + parseModifiers ───────

describe('normalizeKey', () => {
  it('maps xdotool / Anthropic modifier names to Playwright names', () => {
    assert.equal(normalizeKey('ctrl'),    'Control')
    assert.equal(normalizeKey('Control'), 'Control')
    assert.equal(normalizeKey('cmd'),     'Meta')
    assert.equal(normalizeKey('super'),   'Meta')
    assert.equal(normalizeKey('alt'),     'Alt')
    assert.equal(normalizeKey('shift'),   'Shift')
  })

  it('maps common named keys', () => {
    assert.equal(normalizeKey('Return'), 'Enter')
    assert.equal(normalizeKey('Esc'),    'Escape')
    assert.equal(normalizeKey('Up'),     'ArrowUp')
    assert.equal(normalizeKey('page_up'),'PageUp')
  })

  it('passes unknown / single-char keys through verbatim', () => {
    assert.equal(normalizeKey('a'),  'a')
    assert.equal(normalizeKey('F5'), 'F5')
  })
})

describe('normalizeChord', () => {
  it('normalizes each segment of a chord', () => {
    assert.equal(normalizeChord('ctrl+a'),       'Control+a')
    assert.equal(normalizeChord('cmd+shift+t'),  'Meta+Shift+t')
    assert.equal(normalizeChord('Return'),       'Enter')
  })
})

describe('parseModifiers', () => {
  it('returns [] for undefined / empty string', () => {
    assert.deepEqual(parseModifiers(undefined), [])
    assert.deepEqual(parseModifiers(''),        [])
  })

  it('splits on + and normalizes each', () => {
    assert.deepEqual(parseModifiers('shift+ctrl'), ['Shift', 'Control'])
    assert.deepEqual(parseModifiers('cmd'),        ['Meta'])
  })
})

// ─── executeComputerAction — screen / state actions ───────

describe('executeComputerAction — screenshot', () => {
  it('returns image content with PNG bytes', async () => {
    const { page, calls } = makeMockPage()
    const state = makeExecutorState()

    const result = await executeComputerAction(page, { action: 'screenshot' }, state)

    assert.equal(result.type, 'image')
    if (result.type !== 'image') return
    assert.equal(result.media_type, 'image/png')
    assert.ok(result.data instanceof Uint8Array)
    assert.deepEqual(calls.map((c) => c.method), ['screenshot'])
  })

  it('returns error result on screenshot throw — never bubbles up', async () => {
    const { page } = makeMockPage({ throwOn: 'screenshot' })
    const state = makeExecutorState()

    const result = await executeComputerAction(page, { action: 'screenshot' }, state)

    assert.equal(result.type, 'error')
    if (result.type !== 'error') return
    assert.equal(result.text, 'boom in screenshot')
  })
})

describe('executeComputerAction — cursor_position', () => {
  it('returns the current cursor from state without touching the page', async () => {
    const { page, calls } = makeMockPage()
    const state = makeExecutorState({ x: 123, y: 456 })

    const result = await executeComputerAction(page, { action: 'cursor_position' }, state)

    assert.equal(result.type, 'text')
    if (result.type !== 'text') return
    assert.equal(result.text, 'X=123, Y=456')
    assert.equal(calls.length, 0)
  })

  it('reflects the cursor after a preceding mouse_move', async () => {
    const { page } = makeMockPage()
    const state = makeExecutorState()

    await executeComputerAction(page, { action: 'mouse_move', coordinate: [200, 300] }, state)
    const result = await executeComputerAction(page, { action: 'cursor_position' }, state)

    assert.equal(result.type, 'text')
    if (result.type !== 'text') return
    assert.equal(result.text, 'X=200, Y=300')
  })
})

// ─── executeComputerAction — pointer ──────────────────────

describe('executeComputerAction — mouse_move', () => {
  it('calls page.mouse.move with steps and updates state cursor', async () => {
    const { page, calls } = makeMockPage()
    const state = makeExecutorState()

    await executeComputerAction(page, { action: 'mouse_move', coordinate: [400, 250] }, state)

    assert.equal(calls.length, 1)
    assert.equal(calls[0]!.method, 'mouse.move')
    const args = calls[0]!.args as [number, number, { steps?: number } | undefined]
    assert.deepEqual([args[0], args[1]], [400, 250])
    assert.ok(args[2]?.steps !== undefined && args[2].steps > 1, 'steps should be > 1 for smooth move')
    assert.deepEqual(state.cursor, { x: 400, y: 250 })
  })
})

describe('executeComputerAction — left_click', () => {
  it('moves first, then clicks with no modifiers', async () => {
    const { page, calls } = makeMockPage()
    const state = makeExecutorState()

    await executeComputerAction(page, { action: 'left_click', coordinate: [400, 200] }, state)

    assert.deepEqual(
      calls.map((c) => c.method),
      ['mouse.move', 'mouse.click'],
    )
    const clickArgs = calls[1]!.args as [number, number, { button?: string } | undefined]
    assert.deepEqual([clickArgs[0], clickArgs[1]], [400, 200])
    assert.equal(clickArgs[2]?.button, 'left')
    assert.deepEqual(state.cursor, { x: 400, y: 200 })
  })

  it('presses modifiers down before click and releases after, in reverse order', async () => {
    const { page, calls } = makeMockPage()
    const state = makeExecutorState()

    await executeComputerAction(
      page,
      { action: 'left_click', coordinate: [10, 20], text: 'shift+ctrl' },
      state,
    )

    const sequence = calls.map((c) => `${c.method}(${JSON.stringify(c.args)})`)
    // Shift down, Control down, move, click, Control up, Shift up
    assert.deepEqual(
      sequence.map((s) => s.split('(')[0]),
      ['keyboard.down', 'keyboard.down', 'mouse.move', 'mouse.click', 'keyboard.up', 'keyboard.up'],
    )
    assert.deepEqual(calls[0]!.args, ['Shift'])
    assert.deepEqual(calls[1]!.args, ['Control'])
    assert.deepEqual(calls[4]!.args, ['Control'])
    assert.deepEqual(calls[5]!.args, ['Shift'])
  })

  it('still releases modifiers when the click throws', async () => {
    const { page, calls } = makeMockPage({ throwOn: 'mouse.click' })
    const state = makeExecutorState()

    const result = await executeComputerAction(
      page,
      { action: 'left_click', coordinate: [10, 20], text: 'ctrl' },
      state,
    )

    assert.equal(result.type, 'error')
    // keyboard.down, mouse.move, mouse.click (throws), keyboard.up
    assert.deepEqual(
      calls.map((c) => c.method),
      ['keyboard.down', 'mouse.move', 'mouse.click', 'keyboard.up'],
    )
    assert.deepEqual(calls[3]!.args, ['Control'])
  })
})

describe('executeComputerAction — right_click / middle_click / double_click / triple_click', () => {
  it('right_click uses button=right', async () => {
    const { page, calls } = makeMockPage()
    await executeComputerAction(
      page,
      { action: 'right_click', coordinate: [1, 2] },
      makeExecutorState(),
    )
    const clickArgs = calls.find((c) => c.method === 'mouse.click')!.args as unknown[]
    assert.equal((clickArgs[2] as { button?: string }).button, 'right')
  })

  it('middle_click uses button=middle', async () => {
    const { page, calls } = makeMockPage()
    await executeComputerAction(
      page,
      { action: 'middle_click', coordinate: [1, 2] },
      makeExecutorState(),
    )
    const clickArgs = calls.find((c) => c.method === 'mouse.click')!.args as unknown[]
    assert.equal((clickArgs[2] as { button?: string }).button, 'middle')
  })

  it('double_click sends clickCount=2', async () => {
    const { page, calls } = makeMockPage()
    await executeComputerAction(
      page,
      { action: 'double_click', coordinate: [1, 2] },
      makeExecutorState(),
    )
    const clickArgs = calls.find((c) => c.method === 'mouse.click')!.args as unknown[]
    assert.equal((clickArgs[2] as { clickCount?: number }).clickCount, 2)
  })

  it('triple_click sends clickCount=3', async () => {
    const { page, calls } = makeMockPage()
    await executeComputerAction(
      page,
      { action: 'triple_click', coordinate: [1, 2] },
      makeExecutorState(),
    )
    const clickArgs = calls.find((c) => c.method === 'mouse.click')!.args as unknown[]
    assert.equal((clickArgs[2] as { clickCount?: number }).clickCount, 3)
  })
})

describe('executeComputerAction — left_mouse_down / left_mouse_up', () => {
  it('left_mouse_down without coordinate skips the move', async () => {
    const { page, calls } = makeMockPage()
    const state = makeExecutorState({ x: 50, y: 60 })

    await executeComputerAction(page, { action: 'left_mouse_down' }, state)

    assert.deepEqual(
      calls.map((c) => c.method),
      ['mouse.down'],
    )
    assert.deepEqual(state.cursor, { x: 50, y: 60 }, 'cursor unchanged when no coordinate')
  })

  it('left_mouse_down with coordinate moves first and updates cursor', async () => {
    const { page, calls } = makeMockPage()
    const state = makeExecutorState()

    await executeComputerAction(page, { action: 'left_mouse_down', coordinate: [10, 20] }, state)

    assert.deepEqual(
      calls.map((c) => c.method),
      ['mouse.move', 'mouse.down'],
    )
    assert.deepEqual(state.cursor, { x: 10, y: 20 })
  })

  it('left_mouse_up with coordinate moves first', async () => {
    const { page, calls } = makeMockPage()
    const state = makeExecutorState()

    await executeComputerAction(page, { action: 'left_mouse_up', coordinate: [99, 88] }, state)

    assert.deepEqual(
      calls.map((c) => c.method),
      ['mouse.move', 'mouse.up'],
    )
    assert.deepEqual(state.cursor, { x: 99, y: 88 })
  })
})

// ─── executeComputerAction — keyboard ─────────────────────

describe('executeComputerAction — type', () => {
  it('forwards the literal text to keyboard.type', async () => {
    const { page, calls } = makeMockPage()
    await executeComputerAction(page, { action: 'type', text: 'hello world' }, makeExecutorState())
    assert.equal(calls[0]!.method, 'keyboard.type')
    const args = calls[0]!.args as [string, unknown]
    assert.equal(args[0], 'hello world')
  })
})

describe('executeComputerAction — key', () => {
  it('normalizes a single key and presses it', async () => {
    const { page, calls } = makeMockPage()
    await executeComputerAction(page, { action: 'key', text: 'Return' }, makeExecutorState())
    assert.equal(calls[0]!.method, 'keyboard.press')
    assert.equal((calls[0]!.args as [string])[0], 'Enter')
  })

  it('normalizes a chord and presses it as Playwright chord syntax', async () => {
    const { page, calls } = makeMockPage()
    await executeComputerAction(page, { action: 'key', text: 'ctrl+a' }, makeExecutorState())
    assert.equal(calls[0]!.method, 'keyboard.press')
    assert.equal((calls[0]!.args as [string])[0], 'Control+a')
  })
})

describe('executeComputerAction — hold_key', () => {
  it('does down → wait → up around the duration', async () => {
    const { page, calls } = makeMockPage()
    const start = Date.now()

    await executeComputerAction(
      page,
      { action: 'hold_key', text: 'shift', duration: 0.05 },
      makeExecutorState(),
    )

    const elapsed = Date.now() - start
    assert.deepEqual(
      calls.map((c) => c.method),
      ['keyboard.down', 'keyboard.up'],
    )
    assert.deepEqual(calls[0]!.args, ['Shift'])
    assert.deepEqual(calls[1]!.args, ['Shift'])
    assert.ok(elapsed >= 45, `expected to sleep ~50ms, slept ${elapsed}ms`)
  })
})

// ─── executeComputerAction — scroll ───────────────────────

describe('executeComputerAction — scroll', () => {
  it('scrolls down — positive deltaY = scroll_amount * SCROLL_PIXELS_PER_CLICK', async () => {
    const { page, calls } = makeMockPage()
    await executeComputerAction(
      page,
      {
        action: 'scroll',
        coordinate: [100, 100],
        scroll_direction: 'down',
        scroll_amount: 3,
      },
      makeExecutorState(),
    )

    const wheel = calls.find((c) => c.method === 'mouse.wheel')!.args as [number, number]
    assert.equal(wheel[0], 0)
    assert.equal(wheel[1], 3 * SCROLL_PIXELS_PER_CLICK)
  })

  it('scrolls up — negative deltaY', async () => {
    const { page, calls } = makeMockPage()
    await executeComputerAction(
      page,
      { action: 'scroll', coordinate: [0, 0], scroll_direction: 'up', scroll_amount: 1 },
      makeExecutorState(),
    )
    const wheel = calls.find((c) => c.method === 'mouse.wheel')!.args as [number, number]
    assert.equal(wheel[1], -SCROLL_PIXELS_PER_CLICK)
  })

  it('scrolls left — negative deltaX', async () => {
    const { page, calls } = makeMockPage()
    await executeComputerAction(
      page,
      { action: 'scroll', coordinate: [0, 0], scroll_direction: 'left', scroll_amount: 2 },
      makeExecutorState(),
    )
    const wheel = calls.find((c) => c.method === 'mouse.wheel')!.args as [number, number]
    assert.equal(wheel[0], -2 * SCROLL_PIXELS_PER_CLICK)
    assert.equal(wheel[1], 0)
  })

  it('scrolls right — positive deltaX', async () => {
    const { page, calls } = makeMockPage()
    await executeComputerAction(
      page,
      { action: 'scroll', coordinate: [0, 0], scroll_direction: 'right', scroll_amount: 2 },
      makeExecutorState(),
    )
    const wheel = calls.find((c) => c.method === 'mouse.wheel')!.args as [number, number]
    assert.equal(wheel[0], 2 * SCROLL_PIXELS_PER_CLICK)
  })

  it('moves cursor before wheel and updates state', async () => {
    const { page, calls } = makeMockPage()
    const state = makeExecutorState()

    await executeComputerAction(
      page,
      {
        action: 'scroll',
        coordinate: [400, 500],
        scroll_direction: 'down',
        scroll_amount: 1,
      },
      state,
    )

    const moveIdx  = calls.findIndex((c) => c.method === 'mouse.move')
    const wheelIdx = calls.findIndex((c) => c.method === 'mouse.wheel')
    assert.ok(moveIdx >= 0 && wheelIdx > moveIdx, 'move must precede wheel')
    assert.deepEqual(state.cursor, { x: 400, y: 500 })
  })

  it('honors modifier text on scroll (e.g. shift-scroll for horizontal pan)', async () => {
    const { page, calls } = makeMockPage()

    await executeComputerAction(
      page,
      {
        action: 'scroll',
        coordinate: [0, 0],
        scroll_direction: 'down',
        scroll_amount: 1,
        text: 'shift',
      },
      makeExecutorState(),
    )

    assert.equal(calls[0]!.method, 'keyboard.down')
    assert.deepEqual(calls[0]!.args, ['Shift'])
    assert.equal(calls[calls.length - 1]!.method, 'keyboard.up')
    assert.deepEqual(calls[calls.length - 1]!.args, ['Shift'])
  })
})

// ─── executeComputerAction — wait ─────────────────────────

describe('executeComputerAction — wait', () => {
  it('sleeps for duration seconds (subject to ~10ms slack)', async () => {
    const { page } = makeMockPage()
    const start = Date.now()

    const result = await executeComputerAction(
      page,
      { action: 'wait', duration: 0.05 },
      makeExecutorState(),
    )

    const elapsed = Date.now() - start
    assert.equal(result.type, 'text')
    if (result.type !== 'text') return
    assert.equal(result.text, 'waited 0.05s')
    assert.ok(elapsed >= 45, `expected ~50ms, slept ${elapsed}ms`)
  })
})

// ─── executeComputerAction — error path ───────────────────

describe('executeComputerAction — error wrapping', () => {
  it('wraps non-Error throws as { type: "error", text: String(err) }', async () => {
    const page: PageLike = {
      mouse: {
        async move() { throw 'string-error' as unknown as Error },
        async click() { /* unused */ },
        async down() { /* unused */ },
        async up() { /* unused */ },
        async wheel() { /* unused */ },
      },
      keyboard: {
        async type() { /* unused */ },
        async press() { /* unused */ },
        async down() { /* unused */ },
        async up() { /* unused */ },
      },
      async screenshot() { return new Uint8Array() },
    }

    const result = await executeComputerAction(
      page,
      { action: 'mouse_move', coordinate: [1, 1] },
      makeExecutorState(),
    )

    assert.equal(result.type, 'error')
    if (result.type !== 'error') return
    assert.equal(result.text, 'string-error')
  })
})

// ─── ComputerAction type — exhaustiveness sanity ──────────

describe('ComputerAction discriminated union', () => {
  it('every variant is dispatched (compile + runtime exhaustiveness)', async () => {
    const { page } = makeMockPage()
    const state = makeExecutorState()
    const samples: ComputerAction[] = [
      { action: 'screenshot' },
      { action: 'cursor_position' },
      { action: 'wait', duration: 0 },
      { action: 'mouse_move', coordinate: [1, 1] },
      { action: 'left_click',   coordinate: [1, 1] },
      { action: 'right_click',  coordinate: [1, 1] },
      { action: 'middle_click', coordinate: [1, 1] },
      { action: 'double_click', coordinate: [1, 1] },
      { action: 'triple_click', coordinate: [1, 1] },
      { action: 'left_mouse_down' },
      { action: 'left_mouse_up' },
      { action: 'type', text: 'x' },
      { action: 'key',  text: 'a' },
      { action: 'hold_key', text: 'a', duration: 0 },
      {
        action: 'scroll',
        coordinate: [1, 1],
        scroll_direction: 'down',
        scroll_amount: 1,
      },
    ]
    for (const a of samples) {
      const r = await executeComputerAction(page, a, state)
      assert.notEqual(r.type, 'error', `expected ${a.action} to succeed under mock, got error: ${r.type === 'error' ? r.text : ''}`)
    }
  })
})
