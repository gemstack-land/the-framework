import { beforeEach, describe, expect, test, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'

const onPreferences = vi.hoisted(() => vi.fn())
const savePreferences = vi.hoisted(() => vi.fn())
const onProjectPreferences = vi.hoisted(() => vi.fn())
const saveProjectPreferences = vi.hoisted(() => vi.fn())
vi.mock('../server/preferences.telefunc.js', () => ({
  onPreferences,
  savePreferences,
  onProjectPreferences,
  saveProjectPreferences,
}))

const flush = () => act(async () => {
  await Promise.resolve()
  await Promise.resolve()
})

/** Put the test on a project's page: the URL is the selection (#784), and #840 reads it. */
const openProject = (projectId: string | null) =>
  window.history.replaceState({}, '', projectId ? `/${projectId}` : '/')

describe('preferences', () => {
  beforeEach(() => {
    // The cache is module state, so each test needs a fresh module instance.
    vi.resetModules()
    onPreferences.mockReset()
    savePreferences.mockReset().mockResolvedValue({ ok: true })
    onProjectPreferences.mockReset().mockResolvedValue({})
    saveProjectPreferences.mockReset().mockResolvedValue({ ok: true })
    openProject(null)
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

  // Per-project run options (#840).

  test('a project layers its own run options over the global ones', async () => {
    openProject('app-a-14csz1v')
    onPreferences.mockResolvedValue({ autopilot: true, model: 'sonnet', theme: 'dark' })
    onProjectPreferences.mockResolvedValue({ model: 'opus' })
    const { usePreferences } = await import('./preferences.js')

    const { result } = renderHook(() => usePreferences())
    await flush()
    expect(onProjectPreferences).toHaveBeenCalledWith('app-a-14csz1v')
    // The project's model wins; everything it did not set falls through.
    expect(result.current).toEqual({ autopilot: true, model: 'opus', theme: 'dark' })
  })

  test('a run option written on a project page lands on the project, not the globals', async () => {
    openProject('app-a-14csz1v')
    onPreferences.mockResolvedValue({})
    const { usePreferences, updatePreferences } = await import('./preferences.js')

    const { result } = renderHook(() => usePreferences())
    await flush()
    act(() => updatePreferences({ model: 'opus' }))

    expect(saveProjectPreferences).toHaveBeenCalledWith('app-a-14csz1v', { model: 'opus' })
    expect(savePreferences).not.toHaveBeenCalled()
    expect(result.current.model).toBe('opus')
  })

  test('a user-level option stays global even on a project page', async () => {
    openProject('app-a-14csz1v')
    onPreferences.mockResolvedValue({})
    const { usePreferences, updatePreferences } = await import('./preferences.js')

    renderHook(() => usePreferences())
    await flush()
    // theme is about the user, not the repo (#800), so it never lands on a project.
    act(() => updatePreferences({ theme: 'dark' }))

    expect(savePreferences).toHaveBeenCalledWith({ theme: 'dark' })
    expect(saveProjectPreferences).not.toHaveBeenCalled()
  })

  test('a patch spanning both tiers is split across them', async () => {
    openProject('app-a-14csz1v')
    onPreferences.mockResolvedValue({})
    const { usePreferences, updatePreferences } = await import('./preferences.js')

    renderHook(() => usePreferences())
    await flush()
    act(() => updatePreferences({ agent: 'codex', theme: 'light' }))

    expect(saveProjectPreferences).toHaveBeenCalledWith('app-a-14csz1v', { agent: 'codex' })
    expect(savePreferences).toHaveBeenCalledWith({ theme: 'light' })
  })

  test('off a project page every option is global, as before', async () => {
    onPreferences.mockResolvedValue({})
    const { usePreferences, updatePreferences } = await import('./preferences.js')

    renderHook(() => usePreferences())
    await flush()
    act(() => updatePreferences({ model: 'opus' }))

    // The Overview has no project to own the choice, so it sets the fallback.
    expect(savePreferences).toHaveBeenCalledWith({ model: 'opus' })
    expect(saveProjectPreferences).not.toHaveBeenCalled()
    expect(onProjectPreferences).not.toHaveBeenCalled()
  })

  test("one project's options do not follow you into the next", async () => {
    // The bug behind #800: options were one global object, so switching projects carried them.
    openProject('app-a-14csz1v')
    onPreferences.mockResolvedValue({ model: 'sonnet' })
    onProjectPreferences.mockImplementation(async (id: string) => (id === 'app-a-14csz1v' ? { model: 'opus' } : {}))
    const { usePreferences } = await import('./preferences.js')

    const { result, rerender } = renderHook(() => usePreferences())
    await flush()
    expect(result.current.model).toBe('opus')

    openProject('app-b-9zzz')
    rerender()
    await flush()
    // Project B never chose a model, so it gets the global one rather than A's.
    expect(result.current.model).toBe('sonnet')
  })

  test('themePreference falls back to system and resolvedDark honours the choice (#725)', async () => {
    const { themePreference, resolvedDark } = await import('./preferences.js')

    expect(themePreference({})).toBe('system')
    expect(themePreference({ theme: 'light' })).toBe('light')

    // Fixed choices ignore the OS; `system` follows it.
    expect(resolvedDark('dark', false)).toBe(true)
    expect(resolvedDark('light', true)).toBe(false)
    expect(resolvedDark('system', true)).toBe(true)
    expect(resolvedDark('system', false)).toBe(false)
  })
})
