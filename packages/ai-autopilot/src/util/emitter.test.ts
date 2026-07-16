import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { makeEmitter } from './emitter.js'

/** Run `fn` with console.error captured, so a swallowed throw can be asserted on. */
function withCapturedErrors(fn: () => void): string[] {
  const lines: string[] = []
  const real = console.error
  console.error = (...args: unknown[]) => {
    lines.push(args.map(a => (a instanceof Error ? a.message : String(a))).join(' '))
  }
  try {
    fn()
  } finally {
    console.error = real
  }
  return lines
}

describe('makeEmitter', () => {
  it('passes events straight through', () => {
    const seen: string[] = []
    const emit = makeEmitter<string>(e => seen.push(e))
    emit('a')
    emit('b')
    assert.deepEqual(seen, ['a', 'b'])
  })

  it('is a silent no-op with no callback', () => {
    const lines = withCapturedErrors(() => makeEmitter<string>(undefined)('a'))
    assert.deepEqual(lines, [])
  })

  it('swallows a throwing callback so it cannot take the run down', () => {
    const emit = makeEmitter<string>(() => {
      throw new Error('boom')
    })
    const lines = withCapturedErrors(() => {
      emit('a')
      emit('b') // still emitting after the first throw
    })
    assert.equal(lines.length, 2)
  })

  it('names the engine when given one, and does not when not', () => {
    const thrower = () => {
      throw new Error('boom')
    }
    // Byte-identical to what each call site logged before they shared this.
    const unlabelled = withCapturedErrors(() => makeEmitter<string>(thrower)('a'))
    assert.deepEqual(unlabelled, ['[ai-autopilot] onEvent callback threw; ignoring: boom'])

    const labelled = withCapturedErrors(() => makeEmitter<string>(thrower, 'bootstrap')('a'))
    assert.deepEqual(labelled, ['[ai-autopilot] bootstrap onEvent callback threw; ignoring: boom'])

    const overview = withCapturedErrors(() => makeEmitter<string>(thrower, 'overview')('a'))
    assert.deepEqual(overview, ['[ai-autopilot] overview onEvent callback threw; ignoring: boom'])
  })
})
