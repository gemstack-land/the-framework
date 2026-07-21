import { describe, expect, test } from 'vitest'
import type { FrameworkEvent } from '@gemstack/framework'
import { agentViews, pendingChoices, isRunActive, currentRunEvents } from './live-state.js'

const view = (id: string, title: string, markdown: string): FrameworkEvent => ({ kind: 'view', id, title, markdown })
const choice = (id: string, title: string): FrameworkEvent => ({
  kind: 'choice',
  id,
  title,
  options: [{ id: 'a', label: 'A' }],
  recommended: 'a',
})
const resolved = (id: string): FrameworkEvent => ({ kind: 'choice-resolved', id, picked: 'a', by: 'user' })

describe('agentViews', () => {
  test('lists views in first-seen order, one entry each', () => {
    const views = agentViews([view('plan', 'Plan', '# one'), view('diff', 'Diff', '# two')])
    expect(views).toEqual([
      { id: 'plan', title: 'Plan', markdown: '# one' },
      { id: 'diff', title: 'Diff', markdown: '# two' },
    ])
  })

  test('re-showing an id updates it in place rather than stacking a duplicate', () => {
    const views = agentViews([view('plan', 'Plan', '# draft'), view('plan', 'Plan', '# final')])
    expect(views).toEqual([{ id: 'plan', title: 'Plan', markdown: '# final' }])
  })

  test('ignores non-view events', () => {
    expect(agentViews([choice('c1', 'Approve?'), { kind: 'log', message: 'hi' }])).toEqual([])
  })

  test('carries a field added to the view event without a code change here', () => {
    // The mapping strips `kind` and keeps the rest, so an extra field flows through.
    // This is what the old hand-listed `{ id, title, markdown }` mapping would have dropped.
    const extended = { kind: 'view', id: 'plan', title: 'Plan', markdown: '# x', pinned: true } as unknown as FrameworkEvent
    expect(agentViews([extended])).toEqual([{ id: 'plan', title: 'Plan', markdown: '# x', pinned: true }])
  })
})

describe('pendingChoices', () => {
  test('an open choice is pending; a resolved one is not', () => {
    expect(pendingChoices([choice('c1', 'Approve?')]).map(c => c.id)).toEqual(['c1'])
    expect(pendingChoices([choice('c1', 'Approve?'), resolved('c1')])).toEqual([])
  })

  test('tracks several gates at once, in fire order', () => {
    const events = [choice('c1', 'One?'), choice('c2', 'Two?')]
    expect(pendingChoices(events).map(c => c.id)).toEqual(['c1', 'c2'])
  })

  test('strips the kind discriminant from the request', () => {
    const [req] = pendingChoices([choice('c1', 'Approve?')])
    expect(req).not.toHaveProperty('kind')
    expect(req).toMatchObject({ id: 'c1', title: 'Approve?' })
  })
})

describe('isRunActive', () => {
  test('empty is not active; streamed-but-unended is; ended is not', () => {
    expect(isRunActive([])).toBe(false)
    expect(isRunActive([{ kind: 'log', message: 'go' }])).toBe(true)
    expect(isRunActive([{ kind: 'log', message: 'go' }, { kind: 'end', ok: true }])).toBe(false)
  })
})

describe('currentRunEvents', () => {
  const session = (workspace: string): FrameworkEvent => ({ kind: 'session', driver: 'claude', workspace, fake: false })

  test('returns the feed whole when no run has opened yet', () => {
    const events: FrameworkEvent[] = [{ kind: 'log', message: 'warming up' }]
    expect(currentRunEvents(events)).toEqual(events)
  })

  test('keeps a single run intact, session-first', () => {
    const events: FrameworkEvent[] = [session('/repo'), { kind: 'log', message: 'go' }, { kind: 'end', ok: true }]
    expect(currentRunEvents(events)).toEqual(events)
  })

  test('drops a previous run once a new run opens (the bug)', () => {
    const events: FrameworkEvent[] = [
      session('/repo'),
      { kind: 'log', message: 'run 1' },
      { kind: 'end', ok: true },
      session('/repo'),
      { kind: 'log', message: 'run 2' },
    ]
    expect(currentRunEvents(events)).toEqual([session('/repo'), { kind: 'log', message: 'run 2' }])
  })

  test('a just-finished second run keeps its own end, not the first run', () => {
    const events: FrameworkEvent[] = [
      session('/repo'),
      { kind: 'log', message: 'run 1' },
      { kind: 'end', ok: true },
      session('/repo'),
      { kind: 'log', message: 'run 2' },
      { kind: 'end', ok: false, stopped: true },
    ]
    expect(currentRunEvents(events)).toEqual([
      session('/repo'),
      { kind: 'log', message: 'run 2' },
      { kind: 'end', ok: false, stopped: true },
    ])
  })
})
