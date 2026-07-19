import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

// Mock the telefunc shims so the chip's reads and its open are observable without a daemon.
const onRunWorktree = vi.fn(async () => null as unknown)
const sendOpenInApp = vi.fn(async () => ({ ok: true as const }))
vi.mock('../server/reads.telefunc.js', () => ({ onRunWorktree }))
vi.mock('../server/control.telefunc.js', () => ({ sendOpenInApp }))

const { WorktreeChip } = await import('./WorktreeChip.js')

beforeEach(() => {
  onRunWorktree.mockClear()
  sendOpenInApp.mockClear()
})
afterEach(cleanup)

describe('WorktreeChip (#798)', () => {
  test('shows the session branch, and marks uncommitted work', async () => {
    onRunWorktree.mockResolvedValue({
      path: '/repo/.the-framework/worktrees/run-1',
      own: true,
      dirty: true,
      branch: 'the-framework/dark-mode',
    })
    const { container } = render(<WorktreeChip projectId="p1" runId="run-1" />)
    await waitFor(() => expect(screen.getByText('the-framework/dark-mode')).toBeTruthy())
    expect(container.textContent).toContain('•') // the dirty marker
  })

  test('a retained worktree reports what it costs on disk', async () => {
    onRunWorktree.mockResolvedValue({
      path: '/repo/.the-framework/worktrees/run-1',
      own: true,
      dirty: false,
      branch: 'the-framework/dark-mode',
      sizeBytes: 5 * 1024 * 1024,
    })
    render(<WorktreeChip projectId="p1" runId="run-1" />)
    await waitFor(() => expect(screen.getByText('5 MB')).toBeTruthy())
  })

  test('opening addresses the run, not the project', async () => {
    // The whole point is to land in the session's own checkout; opening the project's tree would
    // show the code the session did not write.
    onRunWorktree.mockResolvedValue({ path: '/repo/wt', own: true, dirty: false, branch: 'b' })
    render(<WorktreeChip projectId="p1" runId="run-1" />)
    await waitFor(() => expect(screen.getByText('b')).toBeTruthy())
    fireEvent.click(screen.getByText('b'))
    await waitFor(() => expect(sendOpenInApp).toHaveBeenCalledWith('p1', 'editor', 'run-1'))
  })

  test('renders nothing when there is no checkout to report', async () => {
    onRunWorktree.mockResolvedValue(null)
    const { container } = render(<WorktreeChip projectId="p1" runId="gone" />)
    await waitFor(() => expect(onRunWorktree).toHaveBeenCalled())
    expect(container.textContent).toBe('')
  })

  test('a run without its own worktree says which checkout it is', async () => {
    // The non-git fallback: the run works in the project's tree, where uncommitted changes are
    // the user's own, so the chip must not read as "the session is holding work".
    onRunWorktree.mockResolvedValue({ path: '/repo', own: false, dirty: false })
    render(<WorktreeChip projectId="p1" runId="run-1" />)
    await waitFor(() => expect(screen.getByText('project checkout')).toBeTruthy())
  })
})
