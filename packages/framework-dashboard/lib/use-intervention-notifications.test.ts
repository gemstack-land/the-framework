import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { Intervention } from '@gemstack/framework'
import { useInterventionNotifications } from './use-intervention-notifications.js'

const item = (n: number, url: string): Intervention => ({ projectId: 'p', projectName: 'p', kind: 'pr', number: n, title: `pr ${n}`, url })
const awaiting = (awaitId: string, title: string): Intervention => ({ projectId: 'p', projectName: 'p', kind: 'awaiting', title, url: '', awaitId })

const ctor = vi.fn()

describe('useInterventionNotifications (#627)', () => {
  beforeEach(() => {
    ctor.mockReset()
    class FakeNotification {
      static permission = 'granted'
      onclick: (() => void) | null = null
      constructor(title: string, opts?: NotificationOptions) {
        ctor(title, opts)
      }
      close(): void {}
    }
    vi.stubGlobal('Notification', FakeNotification)
  })
  afterEach(() => vi.unstubAllGlobals())

  const render = (enabled: boolean) =>
    renderHook(({ items }) => useInterventionNotifications(items, enabled), { initialProps: { items: [] as Intervention[] } })

  test('stays quiet for PRs already open at load, then fires for one that appears later', () => {
    const { rerender } = render(true)
    rerender({ items: [item(1, 'u1')] }) // first fetch of an already-open PR -> baseline, no notify
    expect(ctor).not.toHaveBeenCalled()
    rerender({ items: [item(1, 'u1'), item(2, 'u2')] }) // a genuinely new PR -> notify once
    expect(ctor).toHaveBeenCalledTimes(1)
    expect(ctor.mock.calls[0]![0]).toContain('Needs you')
  })

  test('fires for a paused run that appears later, showing its question (#636)', () => {
    const { rerender } = render(true)
    rerender({ items: [] }) // baseline
    rerender({ items: [awaiting('g1', 'Cache the auth store?')] })
    expect(ctor).toHaveBeenCalledTimes(1)
    expect(ctor.mock.calls[0]![1]?.body).toContain('Cache the auth store?')
  })

  test('never fires when notifications are disabled', () => {
    const { rerender } = render(false)
    rerender({ items: [item(1, 'u1')] })
    rerender({ items: [item(1, 'u1'), item(2, 'u2')] })
    expect(ctor).not.toHaveBeenCalled()
  })
})
