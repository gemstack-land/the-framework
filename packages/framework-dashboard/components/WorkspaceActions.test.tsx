import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const onGithubUrl = vi.fn(async () => 'https://github.com/o/r')
const onRunWorktree = vi.fn(async () => null as unknown)
const sendOpenInApp = vi.fn(async () => ({ ok: true as const }))
const sendPreview = vi.fn(async () => ({ ok: true as const, url: 'http://localhost:5173', command: 'dev' }))
const onServeTargets = vi.fn(async () => [{ id: '.', label: 'app', dir: '', script: 'dev' }])
const onPreviewStatus = vi.fn(async () => ({ running: false }))
const sendStopPreview = vi.fn(async () => {})
vi.mock('../server/reads.telefunc.js', () => ({ onGithubUrl, onRunWorktree }))
vi.mock('../server/control.telefunc.js', () => ({
  sendOpenInApp,
  sendPreview,
  onServeTargets,
  onPreviewStatus,
  sendStopPreview,
}))

// The editor picker (#727) lives on the editor button now; stub the preference store and the
// detected-editors read so the tests drive a fixed set.
const updatePreferences = vi.hoisted(() => vi.fn())
let prefs: { editor?: string } = {}
let detectedEditors: { bin: string; label: string }[] = []
vi.mock('../lib/preferences.js', () => ({ usePreferences: () => prefs, updatePreferences }))
vi.mock('../lib/editors.js', () => ({ useDetectedEditors: () => detectedEditors }))

const { WorkspaceActions } = await import('./WorkspaceActions.js')
const { TooltipProvider } = await import('./ui/tooltip.js')

const renderActions = (runId?: string) =>
  render(
    <TooltipProvider>
      <WorkspaceActions projectId="p1" runId={runId} />
    </TooltipProvider>,
  )

// The folder and editor buttons are icon-only; find them by their position among the buttons
// (GitHub is an anchor, so the buttons are: folder, editor, serve).
const buttons = () => screen.getAllByRole('button')

beforeEach(() => {
  sendOpenInApp.mockClear()
  onGithubUrl.mockClear()
  updatePreferences.mockClear()
  prefs = {}
  detectedEditors = []
})
afterEach(cleanup)

// The editor button is a dropdown now (#727): open it, then click the "open" item.
const openEditorMenu = () => fireEvent.click(screen.getByRole('button', { name: /open in editor/i }))

describe('WorkspaceActions (#809)', () => {
  test("a session's folder and editor open that session's worktree", async () => {
    // Opening the project's tree from a session shows the code the session did not write —
    // the same wrongness Serve had before #797.
    renderActions('run-1')
    await waitFor(() => expect(buttons().length).toBeGreaterThan(1))
    fireEvent.click(buttons()[0]!)
    await waitFor(() => expect(sendOpenInApp).toHaveBeenCalledWith('p1', 'files', 'run-1'))
    openEditorMenu()
    fireEvent.click(screen.getByText("Open this session's checkout"))
    await waitFor(() => expect(sendOpenInApp).toHaveBeenCalledWith('p1', 'editor', 'run-1'))
  })

  test('the project home opens the project checkout', async () => {
    renderActions()
    await waitFor(() => expect(buttons().length).toBeGreaterThan(1))
    fireEvent.click(buttons()[0]!)
    await waitFor(() => expect(sendOpenInApp).toHaveBeenCalledWith('p1', 'files', undefined))
  })

  test('both pages offer the same actions', async () => {
    // The point of sharing the component: a session is not missing the repo, the folder or the
    // editor, which is what sent people back to the project page to do anything.
    const project = renderActions()
    await waitFor(() => expect(screen.getByRole('link')).toBeTruthy())
    const projectCount = buttons().length
    cleanup()
    project.unmount()
    renderActions('run-1')
    await waitFor(() => expect(screen.getByRole('link')).toBeTruthy())
    expect(buttons().length).toBe(projectCount)
  })
})

describe('WorkspaceActions editor picker (#727)', () => {
  test('picking a detected editor stores its CLI bin', () => {
    detectedEditors = [
      { bin: 'code', label: 'VS Code' },
      { bin: 'cursor', label: 'Cursor' },
    ]
    renderActions('run-1')
    openEditorMenu()
    fireEvent.click(screen.getByText('Cursor'))
    expect(updatePreferences).toHaveBeenCalledWith({ editor: 'cursor' })
  })

  test('picking Default clears the editor', () => {
    prefs = { editor: 'cursor' }
    detectedEditors = [{ bin: 'cursor', label: 'Cursor' }]
    renderActions('run-1')
    openEditorMenu()
    fireEvent.click(screen.getByText('Default'))
    expect(updatePreferences).toHaveBeenCalledWith({ editor: '' })
  })

  test('shows a stored editor that was not auto-detected as a custom row', () => {
    prefs = { editor: 'mate' }
    detectedEditors = [{ bin: 'code', label: 'VS Code' }]
    renderActions('run-1')
    openEditorMenu()
    // The custom bin appears (as both its own label and description), selectable like the rest.
    expect(screen.getAllByText('mate').length).toBeGreaterThan(0)
  })
})
