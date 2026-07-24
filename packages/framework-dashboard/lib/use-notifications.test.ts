import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { Activity, Intervention } from '@gemstack/the-framework'
import { useActivityNotifications, useInterventionNotifications } from './use-notifications.js'

const ctor = vi.fn()

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

describe('useInterventionNotifications (#627)', () => {
  const item = (n: number, url: string): Intervention => ({ projectId: 'p', projectName: 'p', kind: 'pr', number: n, title: `pr ${n}`, url })
  const awaiting = (awaitId: string, title: string): Intervention => ({ projectId: 'p', projectName: 'p', kind: 'awaiting', title, url: '', awaitId })

  const render = (enabled: boolean) =>
    renderHook(({ items }) => useInterventionNotifications(items, enabled), { initialProps: { items: [] as Intervention[] } })

  test('stays quiet for PRs already open at load, then fires for one that appears later', () => {
    const { rerender } = render(true)
    rerender({ items: [item(1, 'u1')] }) // first fetch of an already-open PR -> baseline, no notify
    expect(ctor).not.toHaveBeenCalled()
    rerender({ items: [item(1, 'u1'), item(2, 'u2')] }) // a genuinely new PR -> notify once
    expect(ctor).toHaveBeenCalledTimes(1)
    expect(ctor.mock.calls[0]![0]).toContain('Human Queue')
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

describe('useActivityNotifications (#627)', () => {
  const startedRun = (runId: string, title?: string): Activity => ({ projectId: 'p', projectName: 'p', runId, kind: 'started', ...(title ? { title } : {}) })
  const finishedRun = (runId: string, title?: string): Activity => ({ projectId: 'p', projectName: 'p', runId, kind: 'finished', ...(title ? { title } : {}) })

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
