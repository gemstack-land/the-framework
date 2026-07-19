import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'

const onFileDiff = vi.fn(async () => null as unknown)
vi.mock('../server/reads.telefunc.js', () => ({ onFileDiff }))

const { FileDiffCard, FileDiffHover } = await import('./FileDiffHover.js')

const DIFF = {
  path: 'src/a.ts',
  status: 'modified',
  patch: '--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-const b = 2\n+const b = 3',
  added: 1,
  removed: 1,
  truncated: false,
  binary: false,
}

beforeEach(() => {
  onFileDiff.mockClear()
  onFileDiff.mockResolvedValue(DIFF)
})
afterEach(cleanup)

describe('FileDiffHover (#816)', () => {
  test('nothing is read until the card opens', () => {
    render(
      <FileDiffHover projectId="p1" runId="run-1" path="src/a.ts">
        <span>a.ts</span>
      </FileDiffHover>,
    )
    // A closed PreviewCard does not mount its popup, and the tree renders one of these per
    // changed file. Fetching on mount would be a git diff per file for diffs nobody asked to see.
    expect(onFileDiff).not.toHaveBeenCalled()
  })
})

describe('FileDiffCard (#816)', () => {
  test("reads the selected run's worktree and renders the diff", async () => {
    render(<FileDiffCard projectId="p1" runId="run-1" path="src/a.ts" />)
    await waitFor(() => expect(onFileDiff).toHaveBeenCalledWith('p1', 'src/a.ts', 'run-1'))
    await waitFor(() => expect(screen.getByText('+const b = 3')).toBeTruthy())
    expect(screen.getByText('-const b = 2')).toBeTruthy()
    expect(screen.getByText('+1')).toBeTruthy()
    expect(screen.getByText('−1')).toBeTruthy()
  })

  test('on the project home it reads the project checkout', async () => {
    render(<FileDiffCard projectId="p1" path="src/a.ts" />)
    await waitFor(() => expect(onFileDiff).toHaveBeenCalledWith('p1', 'src/a.ts', undefined))
  })

  test('a file with nothing to show says so instead of sitting on the spinner', async () => {
    onFileDiff.mockResolvedValue(null)
    render(<FileDiffCard projectId="p1" path="src/a.ts" />)
    await waitFor(() => expect(screen.getByText('No change to show.')).toBeTruthy())
  })

  test('a failed read is not an unhandled rejection', async () => {
    onFileDiff.mockRejectedValue(new Error('daemon restarted'))
    render(<FileDiffCard projectId="p1" path="src/a.ts" />)
    await waitFor(() => expect(onFileDiff).toHaveBeenCalled())
    expect(screen.getByText('Reading the diff…')).toBeTruthy()
  })

  test('a binary file says so rather than rendering bytes', async () => {
    onFileDiff.mockResolvedValue({ ...DIFF, path: 'logo.png', patch: '', added: 0, removed: 0, binary: true })
    render(<FileDiffCard projectId="p1" path="logo.png" />)
    await waitFor(() => expect(screen.getByText('Binary file, nothing to show.')).toBeTruthy())
  })

  test('a cut diff says it was cut', async () => {
    onFileDiff.mockResolvedValue({ ...DIFF, truncated: true })
    render(<FileDiffCard projectId="p1" path="src/a.ts" />)
    await waitFor(() => expect(screen.getByText('Cut here. The rest is in the worktree.')).toBeTruthy())
  })
})
