import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { Activity } from '@gemstack/framework'
import { useActivityNotifications } from './use-activity-notifications.js'

const startedRun = (runId: string, title?: string): Activity => ({ projectId: 'p', projectName: 'p', runId, kind: 'started', ...(title ? { title } : {}) })
const finishedRun = (runId: string, title?: string): Activity => ({ projectId: 'p', projectName: 'p', runId, kind: 'finished', ...(title ? { title } : {}) })

const ctor = vi.fn()

describe('useActivityNotifications (#627)', () => {
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
    renderHook(({ items }) => useActivityNotifications(items, enabled), { initialProps: { items: [] as Activity[] } })

  test('stays quiet for runs already present at load, then fires when a run starts', () => {
    const { rerender } = render(true)
    rerender({ items: [finishedRun('r1', 'seed')] }) // first fetch of an existing run -> baseline, no notify
    expect(ctor).not.toHaveBeenCalled()
    rerender({ items: [startedRun('r2', 'add cart'), finishedRun('r1', 'seed')] }) // a run just started -> notify
    expect(ctor).toHaveBeenCalledTimes(1)
    expect(ctor.mock.calls[0]![0]).toContain('Session started')
    expect(ctor.mock.calls[0]![1]?.body).toContain('add cart')
  })

  test('fires again when the same run finishes (distinct key)', () => {
    const { rerender } = render(true)
    rerender({ items: [] }) // baseline
    rerender({ items: [startedRun('r1', 'work')] }) // started
    rerender({ items: [finishedRun('r1', 'work')] }) // finished -> a new key
    expect(ctor).toHaveBeenCalledTimes(2)
    expect(ctor.mock.calls[1]![0]).toContain('Session finished')
  })

  test('never fires when disabled', () => {
    const { rerender } = render(false)
    rerender({ items: [startedRun('r1')] })
    rerender({ items: [startedRun('r1'), startedRun('r2')] })
    expect(ctor).not.toHaveBeenCalled()
  })
})
