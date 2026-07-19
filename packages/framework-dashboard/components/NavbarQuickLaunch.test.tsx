import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { Preferences } from '@gemstack/framework'

// Stub the shared prefs + the start RPC.
let prefs: Preferences = {}
vi.mock('../lib/preferences.js', () => ({
  usePreferences: () => prefs,
  updatePreferences: vi.fn(),
  autopilotEnabled: (p: Preferences) => p.autopilot ?? true,
}))
const sendStart = vi.hoisted(() => vi.fn())
vi.mock('../server/control.telefunc.js', () => ({ sendStart }))

// Stub the Tiptap editor: an input driving onChange, a ref exposing clear/focus. (Same stub as
// Composer.test — the quick-launch renders the real Composer, whose editor needs a real DOM.)
vi.mock('./PromptEditor.js', async () => {
  const { forwardRef, useImperativeHandle } = await import('react')
  const PromptEditor = forwardRef((props: any, ref: any) => {
    useImperativeHandle(ref, () => ({ clear: () => props.onChange(''), focus: () => {}, loadTemplate: () => {} }))
    return <input aria-label="prompt" onChange={e => props.onChange(e.target.value)} disabled={props.disabled} />
  })
  return { PromptEditor }
})

const { NavbarQuickLaunch } = await import('./NavbarQuickLaunch.js')

function renderQL(over: Partial<Parameters<typeof NavbarQuickLaunch>[0]> = {}) {
  const onRunStarted = vi.fn()
  render(
    <NavbarQuickLaunch
      projectId="p1"
      projectName="demo"
      projects={[]}
      files={[]}
      context={new Set()}
      addContext={vi.fn()}
      onRunStarted={onRunStarted}
      {...over}
    />,
  )
  return { onRunStarted }
}

beforeEach(() => {
  prefs = {}
  sendStart.mockReset()
})
afterEach(cleanup)

describe('NavbarQuickLaunch (#723)', () => {
  test('with no project selected, shows a disabled hint and no editor', () => {
    renderQL({ projectId: null })
    expect(screen.getByText(/select a project to quick-launch/i)).toBeTruthy()
    expect(screen.queryByLabelText('prompt')).toBeNull()
  })

  test('submitting starts a run in the selected project, then clears + jumps to live', async () => {
    sendStart.mockResolvedValue({ ok: true })
    const { onRunStarted } = renderQL()
    fireEvent.change(screen.getByLabelText('prompt'), { target: { value: 'add a test' } })
    fireEvent.click(screen.getByRole('button', { name: 'Start' }))
    await waitFor(() => expect(sendStart).toHaveBeenCalledTimes(1))
    const [projectId, text, kind, options] = sendStart.mock.calls[0]!
    expect(projectId).toBe('p1')
    expect(text).toBe('add a test')
    expect(kind).toBe('build')
    expect(typeof options).toBe('object')
    await waitFor(() => expect(onRunStarted).toHaveBeenCalledWith('add a test'))
  })

  test('surfaces the busy guard when a run is already active', async () => {
    sendStart.mockResolvedValue({ ok: false, busy: true })
    const { onRunStarted } = renderQL()
    fireEvent.change(screen.getByLabelText('prompt'), { target: { value: 'go' } })
    fireEvent.click(screen.getByRole('button', { name: 'Start' }))
    await waitFor(() => expect(screen.getByText(/run is already active/i)).toBeTruthy())
    expect(onRunStarted).not.toHaveBeenCalled()
  })
})
