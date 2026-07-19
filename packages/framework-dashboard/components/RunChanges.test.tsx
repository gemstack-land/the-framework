import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const onRunChanges = vi.fn(async () => [] as unknown)
const onFileDiff = vi.fn(async () => null as unknown)
vi.mock('../server/reads.telefunc.js', () => ({ onRunChanges, onFileDiff }))

const { RunChanges } = await import('./RunChanges.js')

const CHANGES = [
  { path: 'src/a.ts', status: 'modified', added: 3, removed: 1, binary: false },
  { path: 'src/new.ts', status: 'untracked', added: 10, removed: 0, binary: false },
]

beforeEach(() => {
  onRunChanges.mockClear()
  onFileDiff.mockClear()
  onRunChanges.mockResolvedValue(CHANGES)
  onFileDiff.mockResolvedValue({
    path: 'src/a.ts',
    status: 'modified',
    patch: '@@ -1 +1 @@\n-const b = 2\n+const b = 3',
    added: 1,
    removed: 1,
    truncated: false,
    binary: false,
  })
})
afterEach(cleanup)

describe('RunChanges (#817)', () => {
  test("lists the session's changed files with their counts, from its own worktree", async () => {
    render(<RunChanges projectId="p1" runId="run-1" />)
    await waitFor(() => expect(onRunChanges).toHaveBeenCalledWith('p1', 'run-1'))
    await waitFor(() => expect(screen.getByText('a.ts')).toBeTruthy())
    expect(screen.getByText('new.ts')).toBeTruthy()
    expect(screen.getByText('modified')).toBeTruthy()
    expect(screen.getByText('new')).toBeTruthy()
    expect(screen.getByText('2 files')).toBeTruthy()
    // The header totals the files below it: 3 + 10 added, 1 removed.
    expect(screen.getByText('+13')).toBeTruthy()
  })

  test('a session that changed nothing renders nothing, rather than an empty panel', async () => {
    onRunChanges.mockResolvedValue([])
    const { container } = render(<RunChanges projectId="p1" runId="run-1" />)
    await waitFor(() => expect(onRunChanges).toHaveBeenCalled())
    expect(container.textContent).toBe('')
  })

  test('no diff is read until a file is expanded', async () => {
    render(<RunChanges projectId="p1" runId="run-1" />)
    await waitFor(() => expect(screen.getByText('a.ts')).toBeTruthy())
    // A session that touched forty files would otherwise be forty diffs nobody asked for.
    expect(onFileDiff).not.toHaveBeenCalled()

    fireEvent.click(screen.getByText('a.ts'))
    await waitFor(() => expect(onFileDiff).toHaveBeenCalledWith('p1', 'src/a.ts', 'run-1'))
    await waitFor(() => expect(screen.getByText('+const b = 3')).toBeTruthy())
  })

  test('the section collapses, and stops showing the rows', async () => {
    render(<RunChanges projectId="p1" runId="run-1" />)
    await waitFor(() => expect(screen.getByText('a.ts')).toBeTruthy())
    fireEvent.click(screen.getByText('Changes'))
    expect(screen.queryByText('a.ts')).toBeNull()
  })

  test('a failed read leaves the panel silent instead of throwing', async () => {
    onRunChanges.mockRejectedValue(new Error('daemon restarted'))
    const { container } = render(<RunChanges projectId="p1" runId="run-1" />)
    await waitFor(() => expect(onRunChanges).toHaveBeenCalled())
    expect(container.textContent).toBe('')
  })
})
