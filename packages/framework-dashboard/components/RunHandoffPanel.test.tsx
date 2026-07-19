import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const onRunHandoff = vi.fn(async () => null as unknown)
const sendPushBranch = vi.fn(async () => ({ ok: true }) as unknown)
const sendOpenPullRequest = vi.fn(async () => ({ ok: true }) as unknown)
vi.mock('../server/reads.telefunc.js', () => ({ onRunHandoff }))
vi.mock('../server/control.telefunc.js', () => ({ sendPushBranch, sendOpenPullRequest }))

const { RunHandoffPanel } = await import('./RunHandoffPanel.js')

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

beforeEach(() => {
  onRunHandoff.mockClear()
  sendPushBranch.mockClear()
  sendOpenPullRequest.mockClear()
})
afterEach(cleanup)

describe('RunHandoffPanel (#799)', () => {
  test('shows the branch, the commits and the diff a finished session produced', async () => {
    onRunHandoff.mockResolvedValue(worked)
    render(<RunHandoffPanel projectId="p1" runId="run-1" />)
    await waitFor(() => expect(screen.getByText('the-framework/dark-mode')).toBeTruthy())
    expect(screen.getByText('add dark mode')).toBeTruthy()
    expect(screen.getByText('src/theme.ts')).toBeTruthy()
    expect(screen.getByText('1 commit')).toBeTruthy()
  })

  test('a session that changed nothing says so instead of showing an empty branch', async () => {
    onRunHandoff.mockResolvedValue({ ...worked, commits: [], files: [], insertions: 0, deletions: 0, empty: true })
    render(<RunHandoffPanel projectId="p1" runId="run-1" />)
    await waitFor(() => expect(screen.getByText(/changed nothing/)).toBeTruthy())
    // Nothing to hand off means nothing to offer.
    expect(screen.queryByText('Open PR')).toBeNull()
    expect(screen.queryByText('Push branch')).toBeNull()
  })

  test('a branch that is gone is reported, not shown as work', async () => {
    onRunHandoff.mockResolvedValue({ ...worked, exists: false, commits: [], files: [], empty: true })
    render(<RunHandoffPanel projectId="p1" runId="run-1" />)
    await waitFor(() => expect(screen.getByText(/Branch is gone/)).toBeTruthy())
    expect(screen.queryByText('Open PR')).toBeNull()
  })

  test('push is offered only while the branch is unpushed', async () => {
    onRunHandoff.mockResolvedValue({ ...worked, pushed: true })
    render(<RunHandoffPanel projectId="p1" runId="run-1" />)
    await waitFor(() => expect(screen.getByText('Open PR')).toBeTruthy())
    expect(screen.queryByText('Push branch')).toBeNull()
  })

  test('pushing is a click, addressed at this session', async () => {
    onRunHandoff.mockResolvedValue(worked)
    render(<RunHandoffPanel projectId="p1" runId="run-1" />)
    await waitFor(() => expect(screen.getByText('Push branch')).toBeTruthy())
    fireEvent.click(screen.getByText('Push branch'))
    await waitFor(() => expect(sendPushBranch).toHaveBeenCalledWith('p1', 'run-1'))
    // Nothing is published without the click.
    expect(sendOpenPullRequest).not.toHaveBeenCalled()
  })

  test('a failed action surfaces its reason rather than doing nothing', async () => {
    onRunHandoff.mockResolvedValue(worked)
    sendOpenPullRequest.mockResolvedValue({ ok: false, error: 'gh: not logged in' })
    render(<RunHandoffPanel projectId="p1" runId="run-1" />)
    await waitFor(() => expect(screen.getByText('Open PR')).toBeTruthy())
    fireEvent.click(screen.getByText('Open PR'))
    await waitFor(() => expect(screen.getByText('gh: not logged in')).toBeTruthy())
  })

  test('an existing PR replaces the offer, closing the loop back into the dashboard (#632)', async () => {
    onRunHandoff.mockResolvedValue({
      ...worked,
      pushed: true,
      pr: { number: 42, url: 'https://example.test/42', state: 'OPEN', title: 'Add dark mode' },
    })
    render(<RunHandoffPanel projectId="p1" runId="run-1" />)
    await waitFor(() => expect(screen.getByText('PR #42')).toBeTruthy())
    expect(screen.queryByText('Open PR')).toBeNull()
  })

  test('a repo with no remote says why instead of offering a dead button', async () => {
    onRunHandoff.mockResolvedValue({ ...worked, hasRemote: false })
    render(<RunHandoffPanel projectId="p1" runId="run-1" />)
    await waitFor(() => expect(screen.getByText(/No remote to push to/)).toBeTruthy())
    expect(screen.queryByText('Push branch')).toBeNull()
  })

  test('nothing is rendered before the first read, so no wrong empty state flashes', () => {
    onRunHandoff.mockReturnValue(new Promise(() => {}) as never)
    const { container } = render(<RunHandoffPanel projectId="p1" runId="run-1" />)
    expect(container.textContent).toBe('')
  })
})
