import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'

const onFileDiff = vi.fn(async () => null as unknown)
const onFileContent = vi.fn(async () => null as unknown)
vi.mock('../server/reads.telefunc.js', () => ({ onFileDiff, onFileContent }))

const { FilePreviewCard, FilePreviewHover } = await import('./FilePreview.js')

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
  onFileContent.mockClear()
  onFileContent.mockResolvedValue({ path: 'src/a.ts', text: 'const a = 1\nconst b = 2', truncated: false, binary: false })
  onFileDiff.mockResolvedValue(DIFF)
})
afterEach(cleanup)

describe('FilePreviewHover (#816/#828)', () => {
  test('nothing is read until the card opens', () => {
    render(
      <FilePreviewHover projectId="p1" runId="run-1" path="src/a.ts">
        <span>a.ts</span>
      </FilePreviewHover>,
    )
    // A closed PreviewCard does not mount its popup, and the tree renders one of these per
    // changed file. Fetching on mount would be a git diff per file for diffs nobody asked to see.
    expect(onFileDiff).not.toHaveBeenCalled()
  })
})

describe('FilePreviewCard (#816)', () => {
  test("reads the selected run's worktree and renders the diff", async () => {
    render(<FilePreviewCard projectId="p1" runId="run-1" path="src/a.ts" />)
    await waitFor(() => expect(onFileDiff).toHaveBeenCalledWith('p1', 'src/a.ts', 'run-1'))
    await waitFor(() => expect(screen.getByText('+const b = 3')).toBeTruthy())
    expect(screen.getByText('-const b = 2')).toBeTruthy()
    expect(screen.getByText('+1')).toBeTruthy()
    expect(screen.getByText('−1')).toBeTruthy()
  })

  test('on the project home it reads the project checkout', async () => {
    render(<FilePreviewCard projectId="p1" path="src/a.ts" />)
    await waitFor(() => expect(onFileDiff).toHaveBeenCalledWith('p1', 'src/a.ts', undefined))
  })

  test('a file with nothing to show says so instead of sitting on the spinner', async () => {
    onFileDiff.mockResolvedValue(null)
    render(<FilePreviewCard projectId="p1" path="src/a.ts" />)
    await waitFor(() => expect(screen.getByText('No change to show.')).toBeTruthy())
  })

  test('a failed read is not an unhandled rejection', async () => {
    onFileDiff.mockRejectedValue(new Error('daemon restarted'))
    render(<FilePreviewCard projectId="p1" path="src/a.ts" />)
    await waitFor(() => expect(onFileDiff).toHaveBeenCalled())
    expect(screen.getByText('Reading the diff…')).toBeTruthy()
  })

  test('a binary file says so rather than rendering bytes', async () => {
    onFileDiff.mockResolvedValue({ ...DIFF, path: 'logo.png', patch: '', added: 0, removed: 0, binary: true })
    render(<FilePreviewCard projectId="p1" path="logo.png" />)
    await waitFor(() => expect(screen.getByText('Binary file, nothing to show.')).toBeTruthy())
  })

  test('a cut diff says it was cut', async () => {
    onFileDiff.mockResolvedValue({ ...DIFF, truncated: true })
    render(<FilePreviewCard projectId="p1" path="src/a.ts" />)
    await waitFor(() => expect(screen.getByText('Cut here. The rest is in the worktree.')).toBeTruthy())
  })
})

describe('FilePreviewCard on an unchanged file (#828)', () => {
  test('reads the contents rather than a diff, and numbers the lines', async () => {
    render(<FilePreviewCard projectId="p1" runId="run-1" path="src/a.ts" changed={false} />)
    await waitFor(() => expect(onFileContent).toHaveBeenCalledWith('p1', 'src/a.ts', 'run-1'))
    // The status the tree already holds picks the read, so an unchanged file costs no git diff.
    expect(onFileDiff).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.getByText('const a = 1')).toBeTruthy())
    expect(screen.getByText('const b = 2')).toBeTruthy()
    expect(screen.getByText('1')).toBeTruthy()
    expect(screen.getByText('2')).toBeTruthy()
  })

  test('a changed file still reads the diff', async () => {
    render(<FilePreviewCard projectId="p1" runId="run-1" path="src/a.ts" changed />)
    await waitFor(() => expect(onFileDiff).toHaveBeenCalled())
    expect(onFileContent).not.toHaveBeenCalled()
  })

  test('an empty file says so rather than rendering a blank card', async () => {
    onFileContent.mockResolvedValue({ path: 'empty.ts', text: '', truncated: false, binary: false })
    render(<FilePreviewCard projectId="p1" path="empty.ts" changed={false} />)
    await waitFor(() => expect(screen.getByText('Empty file.')).toBeTruthy())
  })

  test('a binary file says so rather than rendering bytes', async () => {
    onFileContent.mockResolvedValue({ path: 'logo.png', text: '', truncated: false, binary: true })
    render(<FilePreviewCard projectId="p1" path="logo.png" changed={false} />)
    await waitFor(() => expect(screen.getByText('Binary file, nothing to show.')).toBeTruthy())
  })

  test('a file too long to show says it was cut', async () => {
    onFileContent.mockResolvedValue({ path: 'big.ts', text: 'a\nb', truncated: true, binary: false })
    render(<FilePreviewCard projectId="p1" path="big.ts" changed={false} />)
    await waitFor(() => expect(screen.getByText('Cut here. The rest is in the worktree.')).toBeTruthy())
  })

  test('an unreadable file says so instead of sitting on the spinner', async () => {
    onFileContent.mockResolvedValue(null)
    render(<FilePreviewCard projectId="p1" path="gone.ts" changed={false} />)
    await waitFor(() => expect(screen.getByText('Nothing to show.')).toBeTruthy())
  })
})
