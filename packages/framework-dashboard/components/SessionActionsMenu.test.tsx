import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

// The ⋮ menu subsumes the old WorkspaceActions / Stop / Remove / Delete row, so it pulls the same
// telefunc + editor reads; stub them the way WorkspaceActions.test did.
const onGithubUrl = vi.fn(async () => 'https://github.com/o/r')
const sendOpenInApp = vi.fn(async () => ({ ok: true as const }))
const sendPreview = vi.fn(async () => ({ ok: true as const, url: 'http://localhost:5173', command: 'dev' }))
const onServeTargets = vi.fn(async () => [] as unknown[])
const onPreviewStatus = vi.fn(async () => ({ running: false }))
const sendStopPreview = vi.fn(async () => {})
const sendStop = vi.fn(async () => {})
const sendRemoveWorktree = vi.fn(async () => ({ ok: true as const }))
const sendDeleteSession = vi.fn(async () => ({ ok: true as const }))
vi.mock('../server/reads.telefunc.js', () => ({ onGithubUrl }))
vi.mock('../server/control.telefunc.js', () => ({
  sendOpenInApp,
  sendPreview,
  onServeTargets,
  onPreviewStatus,
  sendStopPreview,
  sendStop,
  sendRemoveWorktree,
  sendDeleteSession,
}))
vi.mock('../lib/preferences.js', () => ({ usePreferences: () => ({}), updatePreferences: vi.fn() }))
vi.mock('../lib/editors.js', () => ({ useDetectedEditors: () => [] }))

const { SessionActionsMenu } = await import('./SessionActionsMenu.js')

const openMenu = () => fireEvent.click(screen.getByRole('button', { name: /session actions/i }))

beforeEach(() => {
  sendOpenInApp.mockClear()
  sendDeleteSession.mockClear()
})
afterEach(cleanup)

describe('SessionActionsMenu (#toolbar-menu)', () => {
  test('folds the session actions into one menu', async () => {
    render(<SessionActionsMenu projectId="p1" runId="run-1" events={[]} label="my session" onDeleted={vi.fn()} />)
    openMenu()
    await waitFor(() => expect(screen.getByText('Open on GitHub')).toBeTruthy())
    expect(screen.getByText("Open session's folder")).toBeTruthy()
    expect(screen.getByText('Open in editor')).toBeTruthy()
    expect(screen.getByText('Serve')).toBeTruthy()
    expect(screen.getByText('Delete session')).toBeTruthy()
  })

  test("opening the folder targets this session's worktree", async () => {
    render(<SessionActionsMenu projectId="p1" runId="run-1" events={[]} onDeleted={vi.fn()} />)
    openMenu()
    fireEvent.click(await screen.findByText("Open session's folder"))
    await waitFor(() => expect(sendOpenInApp).toHaveBeenCalledWith('p1', 'files', 'run-1'))
  })

  test('Delete asks to confirm before deleting', async () => {
    const onDeleted = vi.fn()
    render(<SessionActionsMenu projectId="p1" runId="run-1" events={[]} label="my session" onDeleted={onDeleted} />)
    openMenu()
    fireEvent.click(await screen.findByText('Delete session'))
    // The confirm dialog, not a bare delete: the session and its history go for good.
    await waitFor(() => expect(screen.getByText('Delete this session?')).toBeTruthy())
    expect(sendDeleteSession).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(sendDeleteSession).toHaveBeenCalledWith('p1', 'run-1'))
  })
})
