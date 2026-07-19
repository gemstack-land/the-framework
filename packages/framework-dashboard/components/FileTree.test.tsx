import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'

const onProjectFileStatus = vi.fn(async () => ({}) as unknown)
vi.mock('../server/reads.telefunc.js', () => ({ onProjectFileStatus }))

const { FileTree } = await import('./FileTree.js')

const noop = () => {}
const files = ['src/app.ts', 'README.md']

beforeEach(() => {
  onProjectFileStatus.mockClear()
  onProjectFileStatus.mockResolvedValue({})
})
afterEach(cleanup)

describe('FileTree (#815)', () => {
  test('the project home reads the project checkout', async () => {
    render(<FileTree projectId="p1" files={files} selected={new Set()} onToggle={noop} />)
    await waitFor(() => expect(onProjectFileStatus).toHaveBeenCalled())
    expect(onProjectFileStatus).toHaveBeenCalledWith('p1', undefined)
  })

  test("a session's dots come from that session's worktree", async () => {
    // The action bar right above the tree has resolved the worktree since #738. Reading the
    // project root here put a clean branch next to another checkout's M/U/D dots.
    render(<FileTree projectId="p1" runId="run-1" files={files} selected={new Set()} onToggle={noop} />)
    await waitFor(() => expect(onProjectFileStatus).toHaveBeenCalled())
    expect(onProjectFileStatus).toHaveBeenCalledWith('p1', 'run-1')
  })

  test('switching session re-reads, rather than keeping the previous one’s dots', async () => {
    const { rerender } = render(
      <FileTree projectId="p1" runId="run-1" files={files} selected={new Set()} onToggle={noop} />,
    )
    await waitFor(() => expect(onProjectFileStatus).toHaveBeenCalledWith('p1', 'run-1'))
    rerender(<FileTree projectId="p1" runId="run-2" files={files} selected={new Set()} onToggle={noop} />)
    await waitFor(() => expect(onProjectFileStatus).toHaveBeenCalledWith('p1', 'run-2'))
  })

  test('a file the run changed is dotted with its status', async () => {
    onProjectFileStatus.mockResolvedValue({ 'README.md': 'modified' })
    render(<FileTree projectId="p1" runId="run-1" files={files} selected={new Set()} onToggle={noop} />)
    await waitFor(() => expect(screen.getByText('M')).toBeTruthy())
  })
})
