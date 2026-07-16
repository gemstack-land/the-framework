import { describe, expect, test } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useAction } from './use-action.js'

describe('useAction', () => {
  test('a successful action returns the result, sets no error, and settles busy', async () => {
    const { result } = renderHook(() => useAction())
    let out: unknown
    await act(async () => {
      out = await result.current.run(async () => ({ ok: true, url: 'x' }))
    })
    expect(out).toEqual({ ok: true, url: 'x' })
    expect(result.current.busy).toBe(false)
    expect(result.current.error).toBe(null)
  })

  test('a { ok: false } result routes into error and returns undefined', async () => {
    const { result } = renderHook(() => useAction())
    let out: unknown = 'sentinel'
    await act(async () => {
      out = await result.current.run(async () => ({ ok: false, error: 'nope' }))
    })
    expect(out).toBe(undefined)
    expect(result.current.error).toBe('nope')
  })

  test('a thrown error routes into error, falling back when it carries no message', async () => {
    const { result } = renderHook(() => useAction())
    await act(async () => {
      await result.current.run(async () => {
        throw new Error('boom')
      })
    })
    expect(result.current.error).toBe('boom')
    await act(async () => {
      await result.current.run(async () => {
        throw 'x'
      }, 'fallback msg')
    })
    expect(result.current.error).toBe('fallback msg')
  })

  test('a void action returns undefined and sets no error on success', async () => {
    const { result } = renderHook(() => useAction())
    let out: unknown = 'sentinel'
    await act(async () => {
      out = await result.current.run(async () => {})
    })
    expect(out).toBe(undefined)
    expect(result.current.error).toBe(null)
  })

  test('reset clears the error', async () => {
    const { result } = renderHook(() => useAction())
    await act(async () => {
      await result.current.run(async () => ({ ok: false, error: 'e' }))
    })
    expect(result.current.error).toBe('e')
    act(() => result.current.reset())
    expect(result.current.error).toBe(null)
  })
})
