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
    // later. The highlight belongs on the optimistic row standing in for it, not on the home row.
    const { container, rerender } = render(
      <RunHistory projectId="p1" runs={[]} selectedRunId={null} onSelect={() => {}} startTick={0} startIntent="" />,
    )
    rerender(
      <RunHistory projectId="p1" runs={[]} selectedRunId="run-2" onSelect={() => {}} startTick={1} startIntent="add dark mode" />,
    )
    const rows = [...container.querySelectorAll('button')]
    const home = rows.find(row => row.textContent?.trim() === 'New')
    const starting = rows.find(row => row.textContent?.includes('starting…'))
    expect(starting?.className).toContain('bg-accent')
    expect(home?.className).not.toContain('bg-accent')
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

// #862: a big view in the right rail takes the room, and the sessions rail gives up its column.
describe('RunHistory collapsed (#862)', () => {
  const rail = (container: HTMLElement) => container.querySelector('aside')!

  test('expanded by default, so nothing changes for the ordinary layout', () => {
    const { container } = render(<RunHistory projectId="p1" runs={[run()]} selectedRunId={null} onSelect={() => {}} />)
    expect(rail(container).className).toContain('w-60')
    expect(rail(container).className).not.toContain('w-12')
  })

  test('collapsed reserves only a strip', () => {
    const { container } = render(
      <RunHistory projectId="p1" runs={[run()]} selectedRunId={null} onSelect={() => {}} collapsed />,
    )
    expect(rail(container).className).toContain('w-12')
  })

  // The rows must stay reachable while narrow: it is a squeeze, not a hidden rail.
  test('collapsed still renders the sessions, and reopens on hover or focus', () => {
    const { container } = render(
      <RunHistory projectId="p1" runs={[run()]} selectedRunId={null} onSelect={() => {}} collapsed />,
    )
    expect(screen.getByText("replace 'Hello, world!' with 'Welcome!'")).toBeTruthy()
    const panel = rail(container).firstElementChild as HTMLElement
    expect(panel.className).toContain('group-hover:w-60')
    expect(panel.className).toContain('group-focus-within:w-60')
  })

  // Floating rather than pushing: hovering the rail must not reflow what is being read.
  test('the collapsed panel floats over the main pane', () => {
    const { container } = render(
      <RunHistory projectId="p1" runs={[run()]} selectedRunId={null} onSelect={() => {}} collapsed />,
    )
    const panel = rail(container).firstElementChild as HTMLElement
    expect(panel.className).toContain('absolute')
  })

  test('a run on a connected device shows a device glyph naming the device (#1067)', () => {
    render(<RunHistory projectId="p1" runs={[run({ target: 'remote', remoteLabel: 'my-laptop' })]} selectedRunId={null} onSelect={() => {}} />)
    expect(screen.getByLabelText('Runs on my-laptop')).toBeTruthy()
  })

  test('a local run has no device glyph (#1067)', () => {
    render(<RunHistory projectId="p1" runs={[run()]} selectedRunId={null} onSelect={() => {}} />)
    expect(screen.queryByLabelText(/Runs on/)).toBeNull()
  })
})
