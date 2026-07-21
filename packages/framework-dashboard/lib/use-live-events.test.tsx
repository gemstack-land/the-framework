import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'

// Record what the feed subscribes to. The channel never sends; we only care about addressing.
const onEvents = vi.hoisted(() => vi.fn())
vi.mock('../server/events.telefunc.js', () => ({ onEvents }))

const { useLiveEvents } = await import('./use-live-events.js')

afterEach(() => {
  cleanup()
  onEvents.mockReset()
  vi.useRealTimers()
})

/** A channel stub that records its onClose callback so a test can drop the stream. */
function fakeChannel() {
  const callbacks: Array<(err?: Error) => void> = []
  return {
    channel: {
      listen: () => {},
      close: () => {},
      onClose: (cb: (err?: Error) => void) => callbacks.push(cb),
    },
    dropWith: (err?: Error) => callbacks.forEach(cb => cb(err)),
  }
}

function Probe({ projectId, runId }: { projectId: string | null; runId?: string | null }) {
  const { lost } = useLiveEvents(projectId, runId)
  return <span>{lost ? 'lost' : 'live'}</span>
}

// #770: right after Start, the run's row does not exist yet. The feed used to subscribe with no run
// id in that window, which resolves server-side to the project root — so a newly started run showed
// the PREVIOUS run's log for a beat before correcting itself. The shell passes the id it got back
// from Start, so there is no window where the feed is pointed at the wrong log.
describe('useLiveEvents addressing (#770)', () => {
  test('subscribes to the run it was given', async () => {
    onEvents.mockResolvedValue(fakeChannel().channel)
    render(<Probe projectId="p1" runId="2026-07-19T13-00-00-000Z" />)
    await waitFor(() => expect(onEvents).toHaveBeenCalledWith('p1', '2026-07-19T13-00-00-000Z'))
  })

  test('resubscribes when the selected run changes, so two runs never share a feed', async () => {
    onEvents.mockResolvedValue(fakeChannel().channel)
    const { rerender } = render(<Probe projectId="p1" runId="run-a" />)
    await waitFor(() => expect(onEvents).toHaveBeenCalledWith('p1', 'run-a'))
    rerender(<Probe projectId="p1" runId="run-b" />)
    await waitFor(() => expect(onEvents).toHaveBeenCalledWith('p1', 'run-b'))
  })

  test('no run id still subscribes per project (the non-git fallback path)', async () => {
    onEvents.mockResolvedValue(fakeChannel().channel)
    render(<Probe projectId="p1" />)
    await waitFor(() => expect(onEvents).toHaveBeenCalledWith('p1', undefined))
  })
})

// #948: a dead stream used to be silent — events just stopped. An errored close must flip `lost`
// and retry; a clean close is the server being done on purpose (relay ended, unknown project) and
// must do neither.
describe('useLiveEvents stream loss (#948)', () => {
  test('an errored close reports the stream lost and resubscribes', async () => {
    const first = fakeChannel()
    onEvents.mockResolvedValue(first.channel)
    render(<Probe projectId="p1" runId="run-a" />)
    await waitFor(() => expect(onEvents).toHaveBeenCalledTimes(1))
    first.dropWith(new Error('connection reset'))
    await waitFor(() => expect(screen.getByText('lost')).toBeTruthy())
    // The retry resubscribes on its own and recovers.
    await waitFor(() => expect(onEvents.mock.calls.length).toBeGreaterThan(1), { timeout: 3000 })
    await waitFor(() => expect(screen.getByText('live')).toBeTruthy(), { timeout: 3000 })
  })

  test('a clean close neither alarms nor retries', async () => {
    const first = fakeChannel()
    onEvents.mockResolvedValue(first.channel)
    render(<Probe projectId="p1" runId="run-a" />)
    await waitFor(() => expect(onEvents).toHaveBeenCalledTimes(1))
    first.dropWith()
    // Give a would-be retry room to fire, then assert it did not.
    await new Promise(resolve => setTimeout(resolve, 1200))
    expect(onEvents).toHaveBeenCalledTimes(1)
    expect(screen.getByText('live')).toBeTruthy()
  })

  test('a failed subscribe reports the stream lost and keeps trying', async () => {
    onEvents.mockRejectedValueOnce(new Error('daemon down')).mockResolvedValue(fakeChannel().channel)
    render(<Probe projectId="p1" runId="run-a" />)
    await waitFor(() => expect(screen.getByText('lost')).toBeTruthy())
    await waitFor(() => expect(screen.getByText('live')).toBeTruthy(), { timeout: 3000 })
  })
})
