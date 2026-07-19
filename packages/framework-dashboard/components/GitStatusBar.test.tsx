import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'

const onGitStatus = vi.fn(async () => null as unknown)
const onRunWorktree = vi.fn(async () => null as unknown)
vi.mock('../server/reads.telefunc.js', () => ({ onGitStatus, onRunWorktree }))

const { GitStatusBar } = await import('./GitStatusBar.js')

beforeEach(() => {
  onGitStatus.mockClear()
  onRunWorktree.mockClear()
})
afterEach(cleanup)

describe('GitStatusBar (#809)', () => {
  test('the project home reads the project checkout', async () => {
    onGitStatus.mockResolvedValue({ branch: 'main', dirty: false })
    render(<GitStatusBar projectId="p1" inline />)
    await waitFor(() => expect(screen.getByText('main')).toBeTruthy())
    expect(screen.getByText('clean')).toBeTruthy()
    expect(onRunWorktree).not.toHaveBeenCalled()
  })

  test("a session reads its own worktree, and reports what only a worktree has", async () => {
    onRunWorktree.mockResolvedValue({
      path: '/repo/.the-framework/worktrees/run-1',
      own: true,
      dirty: true,
      branch: 'the-framework/dark-mode',
      sizeBytes: 5 * 1024 * 1024,
    })
    render(<GitStatusBar projectId="p1" runId="run-1" inline />)
    await waitFor(() => expect(screen.getByText('the-framework/dark-mode')).toBeTruthy())
    expect(screen.getByText('dirty')).toBeTruthy()
    expect(screen.getByText('5 MB')).toBeTruthy()
    expect(onGitStatus).not.toHaveBeenCalled()
  })

  test("a session's PR shows, the way the project's does", async () => {
    // A session's branch is exactly the thing that has a PR, so hiding it there made the one
    // page where it matters most the page without it.
    onRunWorktree.mockResolvedValue({
      path: '/repo/wt',
      own: true,
      dirty: false,
      branch: 'the-framework/dark-mode',
      pr: { number: 42, url: 'https://github.com/o/r/pull/42', state: 'OPEN', title: 'Dark mode' },
    })
    render(<GitStatusBar projectId="p1" runId="run-1" inline />)
    await waitFor(() => expect(screen.getByText('PR #42')).toBeTruthy())
    expect(screen.getByText('open')).toBeTruthy()
  })

  test('the size is omitted while it cannot be read', async () => {
    // A live session is being written to, so the server does not price it; the row must not
    // show a stray placeholder where the number would go.
    onRunWorktree.mockResolvedValue({ path: '/repo/wt', own: true, dirty: false, branch: 'b' })
    const { container } = render(<GitStatusBar projectId="p1" runId="run-1" inline />)
    await waitFor(() => expect(screen.getByText('b')).toBeTruthy())
    expect(container.textContent).not.toContain('–')
  })

  test('nothing renders when there is no checkout to report', async () => {
    onRunWorktree.mockResolvedValue(null)
    const { container } = render(<GitStatusBar projectId="p1" runId="gone" inline />)
    await waitFor(() => expect(onRunWorktree).toHaveBeenCalled())
    expect(container.textContent).toBe('')
  })
})
