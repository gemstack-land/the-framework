import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type { RunMeta } from '@gemstack/framework'

const onRuns = vi.hoisted(() => vi.fn())
vi.mock('../server/reads.telefunc.js', () => ({ onRuns }))

const { useRuns } = await import('./use-runs.js')

const runs = (id: string): RunMeta[] => [{ id, status: 'done' } as RunMeta]
const settle = (ms = 0): Promise<void> => act(async () => void (await vi.advanceTimersByTimeAsync(ms)))

describe('useRuns', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    onRuns.mockReset()
  })
  afterEach(() => vi.useRealTimers())

  test('reads nothing until a project is selected', async () => {
    const { result } = renderHook(() => useRuns(null))
    await settle(10_000)
    expect(onRuns).not.toHaveBeenCalled()
    expect(result.current.runs).toEqual([])
  })

  test('polls the selected project every 2s', async () => {
    onRuns.mockResolvedValue(runs('a1'))
    const { result } = renderHook(() => useRuns('a'))
    await settle()
    expect(result.current.runs).toEqual(runs('a1'))

    onRuns.mockResolvedValue(runs('a2'))
    await settle(2000)
    expect(result.current.runs).toEqual(runs('a2'))
  })

  test('reload shows a just-started run without waiting for the next tick', async () => {
    onRuns.mockResolvedValue(runs('a1'))
    const { result } = renderHook(() => useRuns('a'))
    await settle()

    onRuns.mockResolvedValue(runs('a2'))
    await act(async () => result.current.reload())
    expect(result.current.runs).toEqual(runs('a2'))
  })

  test('a reload in flight during a project switch cannot write the old project s runs', async () => {
    let resolveA: (v: RunMeta[]) => void = () => {}
    onRuns.mockResolvedValue(runs('a1'))
    const { result, rerender } = renderHook(({ id }) => useRuns(id), { initialProps: { id: 'a' } })
    await settle()

    onRuns.mockReturnValue(new Promise<RunMeta[]>(r => (resolveA = r)))
    result.current.reload() // in flight against project a
    onRuns.mockResolvedValue(runs('b1'))
    rerender({ id: 'b' })
    await settle()
    expect(result.current.runs).toEqual(runs('b1'))

    resolveA(runs('a-late')) // a's reload lands after the switch
    await settle()
    expect(result.current.runs).toEqual(runs('b1')) // b's rail never shows a's runs
  })

  test('switching project clears the previous project s runs rather than showing them', async () => {
    onRuns.mockResolvedValue(runs('a1'))
    const { result, rerender } = renderHook(({ id }) => useRuns(id), { initialProps: { id: 'a' } })
    await settle()
    expect(result.current.runs).toEqual(runs('a1'))

    let resolveB: (v: RunMeta[]) => void = () => {}
    onRuns.mockReturnValue(new Promise<RunMeta[]>(r => (resolveB = r)))
    rerender({ id: 'b' })
    expect(result.current.runs).toEqual([]) // not a's runs, while b is still loading

    await act(async () => resolveB(runs('b1')))
    expect(result.current.runs).toEqual(runs('b1'))
  })

  test('a failed read keeps the last runs rather than emptying the rail', async () => {
    onRuns.mockResolvedValue(runs('a1'))
    const { result } = renderHook(() => useRuns('a'))
    await settle()

    onRuns.mockRejectedValue(new Error('daemon restarted'))
    await settle(2000)
    expect(result.current.runs).toEqual(runs('a1')) // and no unhandled rejection
  })
})
