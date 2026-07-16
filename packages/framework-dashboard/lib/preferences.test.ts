import { beforeEach, describe, expect, test, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'

const onPreferences = vi.hoisted(() => vi.fn())
const savePreferences = vi.hoisted(() => vi.fn())
vi.mock('../server/preferences.telefunc.js', () => ({ onPreferences, savePreferences }))

const flush = () => act(async () => {
  await Promise.resolve()
  await Promise.resolve()
})

describe('preferences', () => {
  beforeEach(() => {
    // The cache is module state, so each test needs a fresh module instance.
    vi.resetModules()
    onPreferences.mockReset()
    savePreferences.mockReset().mockResolvedValue({ ok: true })
  })

  test('an optimistic update made during the initial load survives the load resolving', async () => {
    let resolveLoad: (p: unknown) => void = () => {}
    onPreferences.mockReturnValue(new Promise(r => (resolveLoad = r)))
    const { usePreferences, updatePreferences, autopilotEnabled } = await import('./preferences.js')

    const { result } = renderHook(() => usePreferences())
    // The load is in flight; the user toggles autopilot off before it resolves.
    act(() => updatePreferences({ autopilot: false }))
    expect(autopilotEnabled(result.current)).toBe(false)

    // The load now resolves with the server's pre-toggle value; the toggle must win.
    await act(async () => {
      resolveLoad({ autopilot: true })
      await Promise.resolve()
    })
    expect(autopilotEnabled(result.current)).toBe(false)
  })

  test('the initial load populates the cache when no optimistic write raced it', async () => {
    onPreferences.mockResolvedValue({ autopilot: false, technical: true })
    const { usePreferences } = await import('./preferences.js')

    const { result } = renderHook(() => usePreferences())
    await flush()
    expect(result.current).toEqual({ autopilot: false, technical: true })
  })
})
