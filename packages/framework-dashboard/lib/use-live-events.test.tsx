import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'

// Record what the feed subscribes to. The channel never sends; we only care about addressing.
const onEvents = vi.hoisted(() => vi.fn())
vi.mock('../server/events.telefunc.js', () => ({ onEvents }))

const { useLiveEvents } = await import('./use-live-events.js')

afterEach(() => {
  cleanup()
  onEvents.mockReset()
})

function Probe({ projectId, runId }: { projectId: string | null; runId?: string | null }) {
  useLiveEvents(projectId, runId)
  return null
}

// #770: right after Start, the run's row does not exist yet. The feed used to subscribe with no run
// id in that window, which resolves server-side to the project root — so a newly started run showed
// the PREVIOUS run's log for a beat before correcting itself. The shell passes the id it got back
// from Start, so there is no window where the feed is pointed at the wrong log.
describe('useLiveEvents addressing (#770)', () => {
  test('subscribes to the run it was given', async () => {
    onEvents.mockResolvedValue({ listen: () => {}, close: () => {} })
    render(<Probe projectId="p1" runId="2026-07-19T13-00-00-000Z" />)
    await waitFor(() => expect(onEvents).toHaveBeenCalledWith('p1', '2026-07-19T13-00-00-000Z'))
  })

  test('resubscribes when the selected run changes, so two runs never share a feed', async () => {
    onEvents.mockResolvedValue({ listen: () => {}, close: () => {} })
    const { rerender } = render(<Probe projectId="p1" runId="run-a" />)
    await waitFor(() => expect(onEvents).toHaveBeenCalledWith('p1', 'run-a'))
    rerender(<Probe projectId="p1" runId="run-b" />)
    await waitFor(() => expect(onEvents).toHaveBeenCalledWith('p1', 'run-b'))
  })

  test('no run id still subscribes per project (the non-git fallback path)', async () => {
    onEvents.mockResolvedValue({ listen: () => {}, close: () => {} })
    render(<Probe projectId="p1" />)
    await waitFor(() => expect(onEvents).toHaveBeenCalledWith('p1', undefined))
  })
})
