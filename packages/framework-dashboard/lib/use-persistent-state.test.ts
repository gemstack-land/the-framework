import { afterEach, describe, expect, test } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { usePersistentState } from './use-persistent-state.js'

const KEY = 'test.persistent'

describe('usePersistentState', () => {
  afterEach(() => window.localStorage.clear())

  test('initializes from localStorage, or null when unset', () => {
    expect(renderHook(() => usePersistentState(KEY)).result.current[0]).toBe(null)

    window.localStorage.setItem(KEY, 'p1')
    expect(renderHook(() => usePersistentState(KEY)).result.current[0]).toBe('p1')
  })

  test('persists on set, and clears the key when set to null', () => {
    const { result } = renderHook(() => usePersistentState(KEY))

    act(() => result.current[1]('proj-a'))
    expect(result.current[0]).toBe('proj-a')
    expect(window.localStorage.getItem(KEY)).toBe('proj-a')

    act(() => result.current[1](null))
    expect(result.current[0]).toBe(null)
    expect(window.localStorage.getItem(KEY)).toBe(null)
  })
})
