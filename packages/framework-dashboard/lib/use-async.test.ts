import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useLoaded, usePolled } from './use-async.js'

/** Let queued reads settle and React apply the state they resolved with. */
const settle = (ms = 0): Promise<void> => act(async () => void (await vi.advanceTimersByTimeAsync(ms)))

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('useLoaded', () => {
  test('holds the initial value until the answer arrives, then reports it', async () => {
    const load = vi.fn().mockResolvedValue('answer')
    const { result } = renderHook(() => useLoaded(load, 'initial', []))
    expect(result.current).toBe('initial')
    await settle()
    expect(result.current).toBe('answer')
  })

  test('does not read at all when there is nothing to read yet', async () => {
    const { result } = renderHook(() => useLoaded<string[]>(null, [], [undefined]))
    await settle()
    expect(result.current).toEqual([])
  })

  test('re-reads when deps change, and resets rather than showing the last dep-s value', async () => {
    const load = vi.fn((id: string) => Promise.resolve(`data-${id}`))
    const { result, rerender } = renderHook(({ id }) => useLoaded(() => load(id), 'initial', [id]), {
      initialProps: { id: 'a' },
    })
    await settle()
    expect(result.current).toBe('data-a')

    rerender({ id: 'b' })
    expect(result.current).toBe('initial') // not 'data-a': b's panel must not show a's data
    await settle()
    expect(result.current).toBe('data-b')
  })

  test('a read that lands after its deps changed is dropped', async () => {
    let resolveA: (v: string) => void = () => {}
    const load = vi.fn((id: string) =>
      id === 'a' ? new Promise<string>(r => (resolveA = r)) : Promise.resolve(`data-${id}`),
    )
    const { result, rerender } = renderHook(({ id }) => useLoaded(() => load(id), 'initial', [id]), {
      initialProps: { id: 'a' },
    })
    rerender({ id: 'b' })
    await settle()
    expect(result.current).toBe('data-b')

    resolveA('data-a') // a's read finally lands, but a is not what is on screen
    await settle()
    expect(result.current).toBe('data-b')
  })

  test('a rejected read keeps the last value rather than blanking it', async () => {
    const load = vi.fn().mockResolvedValue('answer')
    const { result } = renderHook(() => useLoaded(load, 'initial', []))
    await settle()

    load.mockRejectedValue(new Error('daemon restarted'))
    await settle()
    expect(result.current).toBe('answer') // and no unhandled rejection: vitest fails the run on one
  })
})

describe('usePolled', () => {
  test('re-reads on its interval', async () => {
    const load = vi.fn().mockResolvedValue(1)
    const { result } = renderHook(() => usePolled(load, 0, 5000, []))
    await settle()
    expect(result.current.value).toBe(1)

    load.mockResolvedValue(2)
    await settle(5000)
    expect(result.current.value).toBe(2)
  })

  test('stops polling once unmounted', async () => {
    const load = vi.fn().mockResolvedValue(1)
    const { unmount } = renderHook(() => usePolled(load, 0, 5000, []))
    await settle()
    expect(load).toHaveBeenCalledTimes(1)

    unmount()
    await settle(50_000)
    expect(load).toHaveBeenCalledTimes(1)
  })

  test('a rejected read keeps the last value and polling survives it', async () => {
    const load = vi.fn().mockResolvedValue(1)
    const { result } = renderHook(() => usePolled(load, 0, 5000, []))
    await settle()

    load.mockRejectedValue(new Error('daemon restarted'))
    await settle(5000)
    expect(result.current.value).toBe(1) // kept, not blanked

    load.mockResolvedValue(3)
    await settle(5000)
    expect(result.current.value).toBe(3) // the next tick recovers
  })

  test('reload reads immediately, without waiting for the next tick', async () => {
    const load = vi.fn().mockResolvedValue(1)
    const { result } = renderHook(() => usePolled(load, 0, 5000, []))
    await settle()

    load.mockResolvedValue(2)
    await act(async () => result.current.reload())
    expect(result.current.value).toBe(2)
  })

  test('reload cannot write back after unmount', async () => {
    let resolveLate: (v: number) => void = () => {}
    const load = vi.fn().mockResolvedValue(1)
    const { result, unmount } = renderHook(() => usePolled(load, 0, 5000, []))
    await settle()

    load.mockReturnValue(new Promise<number>(r => (resolveLate = r)))
    const { reload } = result.current
    reload()
    unmount()
    resolveLate(99) // the in-flight reload lands after teardown
    await settle()
    expect(result.current.value).toBe(1) // never applied
  })

  test('does not poll when there is nothing to read yet', async () => {
    const { result } = renderHook(() => usePolled<string[]>(null, [], 5000, [undefined]))
    await settle(20_000)
    expect(result.current.value).toEqual([])
  })
})
