import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const onRunHandoff = vi.fn(async () => null as unknown)
const sendPushBranch = vi.fn(async () => ({ ok: true }) as unknown)
const sendOpenPullRequest = vi.fn(async () => ({ ok: true }) as unknown)
vi.mock('../server/reads.telefunc.js', () => ({ onRunHandoff }))
vi.mock('../server/control.telefunc.js', () => ({ sendPushBranch, sendOpenPullRequest }))

const { HandoffActions, HandoffSummary, RunHandoffDetails, handoffExpandable } = await import('./RunHandoff.js')
const { useRunHandoff } = await import('../lib/use-run-handoff.js')

/** A handoff for a session that did real work, on a repo with a remote and no PR yet. */
const worked = {
  branch: 'the-framework/dark-mode',
  exists: true,
  base: 'origin/main',
  commits: [{ sha: 'aaaaaaa1', short: 'aaaaaaa', subject: 'add dark mode' }],
  files: [{ path: 'src/theme.ts', insertions: 12, deletions: 3, binary: false }],
  insertions: 12,
  deletions: 3,
  empty: false,
  hasRemote: true,
  pushed: false,
  merged: false,
}

// The same composition RunReplay uses: the verdict and the next step in the action bar, the
// commits and files behind the bar's disclosure.
function Harness({ open = true }: { open?: boolean }) {
  const state = useRunHandoff('p1', 'run-1')
  return (
    <>
      <HandoffSummary handoff={state.handoff} />
      {state.error && <span>{state.error}</span>}
      <HandoffActions projectId="p1" runId="run-1" state={state} />
      {open && handoffExpandable(state.handoff) && <RunHandoffDetails handoff={state.handoff} />}
    </>
  )
}

beforeEach(() => {
  onRunHandoff.mockClear()
  sendPushBranch.mockClear()
  sendOpenPullRequest.mockClear()
  sendOpenPullRequest.mockResolvedValue({ ok: true })
})
afterEach(cleanup)

describe('run handoff (#799)', () => {
  test('summarises what a finished session produced, and lists it when expanded', async () => {
    onRunHandoff.mockResolvedValue(worked)
    render(<Harness />)
    await waitFor(() => expect(screen.getByText('1 commit')).toBeTruthy())
    expect(screen.getByText('1 file')).toBeTruthy()
    expect(screen.getByText('add dark mode')).toBeTruthy()
    expect(screen.getByText('src/theme.ts')).toBeTruthy()
  })

  test('collapsed, it still says what the branch holds — without the lists (#1023)', async () => {
    onRunHandoff.mockResolvedValue(worked)
    render(<Harness open={false} />)
    await waitFor(() => expect(screen.getByText('1 commit')).toBeTruthy())
    expect(screen.queryByText('add dark mode')).toBeNull()
    expect(screen.queryByText('src/theme.ts')).toBeNull()
    // The next step is never hidden behind the disclosure.
    expect(screen.getByText('Push branch')).toBeTruthy()
  })

  test('the branch name is not repeated — the action bar it sits in already says it (#1023)', async () => {
    onRunHandoff.mockResolvedValue(worked)
    render(<Harness />)
    await waitFor(() => expect(screen.getByText('1 commit')).toBeTruthy())
    expect(screen.queryByText('the-framework/dark-mode')).toBeNull()
  })

  test('a session that changed nothing says so, and has nothing to expand', async () => {
    onRunHandoff.mockResolvedValue({ ...worked, commits: [], files: [], insertions: 0, deletions: 0, empty: true })
    render(<Harness />)
    await waitFor(() => expect(screen.getByText('no changes')).toBeTruthy())
    expect(handoffExpandable({ ...worked, empty: true } as never)).toBe(false)
    // Nothing to hand off means nothing to offer.
    expect(screen.queryByText('Open PR')).toBeNull()
    expect(screen.queryByText('Push branch')).toBeNull()
  })

  test('a branch that is gone is reported, not shown as work', async () => {
    onRunHandoff.mockResolvedValue({ ...worked, exists: false, commits: [], files: [], empty: true })
    render(<Harness />)
    await waitFor(() => expect(screen.getByText('branch gone')).toBeTruthy())
    expect(screen.queryByText('Open PR')).toBeNull()
  })

  test('push is offered only while the branch is unpushed', async () => {
    onRunHandoff.mockResolvedValue({ ...worked, pushed: true })
    render(<Harness />)
    await waitFor(() => expect(screen.getByText('Open PR')).toBeTruthy())
    expect(screen.queryByText('Push branch')).toBeNull()
  })

  test('pushing is a click, addressed at this session', async () => {
    onRunHandoff.mockResolvedValue(worked)
    render(<Harness />)
    await waitFor(() => expect(screen.getByText('Push branch')).toBeTruthy())
    fireEvent.click(screen.getByText('Push branch'))
    await waitFor(() => expect(sendPushBranch).toHaveBeenCalledWith('p1', 'run-1'))
    // Nothing is published without the click.
    expect(sendOpenPullRequest).not.toHaveBeenCalled()
  })

  test('a failed action surfaces its reason rather than doing nothing', async () => {
    onRunHandoff.mockResolvedValue(worked)
    sendOpenPullRequest.mockResolvedValue({ ok: false, error: 'gh: not logged in' })
    render(<Harness />)
    await waitFor(() => expect(screen.getByText('Open PR')).toBeTruthy())
    fireEvent.click(screen.getByText('Open PR'))
    await waitFor(() => expect(screen.getByText('gh: not logged in')).toBeTruthy())
  })

  test('an existing PR withdraws the offer — the bar links it instead (#632)', async () => {
    onRunHandoff.mockResolvedValue({
      ...worked,
      pushed: true,
      pr: { number: 42, url: 'https://example.test/42', state: 'OPEN', title: 'Add dark mode' },
    })
    render(<Harness />)
    await waitFor(() => expect(screen.getByText('1 commit')).toBeTruthy())
    expect(screen.queryByText('Open PR')).toBeNull()
    expect(screen.queryByText('Push branch')).toBeNull()
  })

  test('a repo with no remote says why instead of offering a dead button', async () => {
    onRunHandoff.mockResolvedValue({ ...worked, hasRemote: false })
    render(<Harness />)
    await waitFor(() => expect(screen.getByText(/No remote to push to/)).toBeTruthy())
    expect(screen.queryByText('Push branch')).toBeNull()
  })

  test('nothing is rendered before the first read, so no wrong empty state flashes', () => {
    onRunHandoff.mockReturnValue(new Promise(() => {}) as never)
    const { container } = render(<Harness />)
    expect(container.textContent).toBe('')
  })
})
