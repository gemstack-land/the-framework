import type { RunMeta } from '@gemstack/framework'
import { afterEach, describe, expect, test } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { RunHistory } from './RunHistory.js'

afterEach(cleanup)

function run(over: Partial<RunMeta> = {}): RunMeta {
  return {
    version: 1,
    status: 'running',
    id: 'run-1',
    startedAt: '2026-07-19T16:05:44.756Z',
    updatedAt: '2026-07-19T16:06:21.000Z',
    passes: 1,
    intent: "replace 'Hello, world!' with 'Welcome!'",
    ...over,
  }
}

describe('RunHistory (#785)', () => {
  test('a working run reads as running and animates', () => {
    const { container } = render(<RunHistory projectId="p1" runs={[run()]} selectedRunId={null} onSelect={() => {}} />)
    expect(screen.getByText('running')).toBeTruthy()
    expect(container.querySelector('.animate-pulse')).toBeTruthy()
  })

  test('a run parked on the user reads as waiting and stops animating', () => {
    // The build settled and it is waiting for a message: same live process, different meaning.
    const { container } = render(
      <RunHistory projectId="p1" runs={[run({ settledAt: '2026-07-19T16:06:21.000Z' })]} selectedRunId={null} onSelect={() => {}} />,
    )
    expect(screen.getByText('waiting')).toBeTruthy()
    expect(screen.queryByText('running')).toBeNull()
    expect(container.querySelector('.animate-pulse')).toBeNull()
  })

  test('a session selected before its row lands highlights the starting row (#784)', () => {
    // Start navigates to the run's id right away; its run.json, and so its row, arrives a beat
    // later. The highlight belongs on the optimistic row standing in for it, not on Live.
    const { container, rerender } = render(
      <RunHistory projectId="p1" runs={[]} selectedRunId={null} onSelect={() => {}} startTick={0} startIntent="" />,
    )
    rerender(
      <RunHistory projectId="p1" runs={[]} selectedRunId="run-2" onSelect={() => {}} startTick={1} startIntent="add dark mode" />,
    )
    const rows = [...container.querySelectorAll('button')]
    const live = rows.find(row => row.textContent?.includes('Live'))
    const starting = rows.find(row => row.textContent?.includes('starting…'))
    expect(starting?.className).toContain('bg-accent')
    expect(live?.className).not.toContain('bg-accent')
  })

  test('a finished run is finished, never waiting', () => {
    // settledAt is cleared on `end`, but a stale one must not relabel a terminal status.
    render(
      <RunHistory
        projectId="p1"
        runs={[run({ status: 'done', settledAt: '2026-07-19T16:06:21.000Z' })]}
        selectedRunId={null}
        onSelect={() => {}}
      />,
    )
    expect(screen.getByText('done')).toBeTruthy()
    expect(screen.queryByText('waiting')).toBeNull()
  })
})
