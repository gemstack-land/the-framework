import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

// Mock the telefunc shim so the component's RPCs are observable without a daemon.
const sendPreview = vi.fn(async () => ({ ok: true as const, url: 'http://localhost:5173', command: 'dev' }))
const onServeTargets = vi.fn(async () => [] as { id: string; label: string; dir: string; script: string }[])
const onPreviewStatus = vi.fn(async () => ({ running: false }))
const sendStopPreview = vi.fn(async () => {})
vi.mock('../server/control.telefunc.js', () => ({ sendPreview, onServeTargets, onPreviewStatus, sendStopPreview }))

const { PreviewBar } = await import('./PreviewBar.js')

beforeEach(() => {
  sendPreview.mockClear()
  onServeTargets.mockClear()
  onPreviewStatus.mockClear()
})
afterEach(cleanup)

const twoTargets = [
  { id: 'apps/web', label: 'web', dir: 'apps/web', script: 'dev' },
  { id: 'apps/api', label: 'api', dir: 'apps/api', script: 'start' },
]

describe('PreviewBar serve picker (#651)', () => {
  test('a single-target repo shows one plain Serve button that serves the default', async () => {
    onServeTargets.mockResolvedValueOnce([{ id: '.', label: 'app', dir: '', script: 'dev' }])
    render(<PreviewBar projectId="p1" inline />)
    await waitFor(() => expect(onServeTargets).toHaveBeenCalled())
    // One target → a single Serve button (no caret split control).
    expect(screen.getAllByRole('button')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button'))
    // No target id → the daemon serves the root/remembered default.
    await waitFor(() => expect(sendPreview).toHaveBeenCalledWith('p1', undefined, undefined))
  })

  test('a multi-target repo offers a picker; choosing an app serves that target', async () => {
    onServeTargets.mockResolvedValueOnce(twoTargets)
    render(<PreviewBar projectId="p2" inline />)
    // >1 target → a split control: [primary Serve, caret picker].
    await waitFor(() => expect(screen.getAllByRole('button')).toHaveLength(2))
    fireEvent.click(screen.getAllByRole('button')[1]!) // open the caret dropdown
    fireEvent.click(await screen.findByText('api'))
    await waitFor(() => expect(sendPreview).toHaveBeenCalledWith('p2', 'apps/api', undefined))
  })

  test('the multi-target primary button serves the last pick (no explicit id)', async () => {
    onServeTargets.mockResolvedValueOnce(twoTargets)
    render(<PreviewBar projectId="p3" inline />)
    await waitFor(() => expect(screen.getAllByRole('button')).toHaveLength(2))
    fireEvent.click(screen.getAllByRole('button')[0]!) // the primary Serve
    await waitFor(() => expect(sendPreview).toHaveBeenCalledWith('p3', undefined, undefined))
  })
})

describe('PreviewBar addressing (#797)', () => {
  test("a session's Serve addresses that session, so it boots the session's own worktree", async () => {
    onServeTargets.mockResolvedValueOnce([{ id: '.', label: 'app', dir: '', script: 'dev' }])
    render(<PreviewBar projectId="p1" runId="run-1" inline />)
    await waitFor(() => expect(onServeTargets).toHaveBeenCalledWith('p1', 'run-1'))
    // The rehydrate has to be run-addressed too, or a reload adopts the project preview's URL
    // as if it were the session's.
    expect(onPreviewStatus).toHaveBeenCalledWith('p1', 'run-1')
    fireEvent.click(screen.getByRole('button')) // icon-only inline control
    await waitFor(() => expect(sendPreview).toHaveBeenCalledWith('p1', undefined, 'run-1'))
  })

  test('the project home stays unaddressed, serving the project checkout', async () => {
    onServeTargets.mockResolvedValueOnce([{ id: '.', label: 'app', dir: '', script: 'dev' }])
    render(<PreviewBar projectId="p1" inline />)
    await waitFor(() => expect(onServeTargets).toHaveBeenCalledWith('p1', undefined))
  })
})
