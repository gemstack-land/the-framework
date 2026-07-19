import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { Preferences } from '@gemstack/framework'

// Stub the shared prefs + the start RPC.
let prefs: Preferences = {}
vi.mock('../lib/preferences.js', () => ({
  usePreferences: () => prefs,
  updatePreferences: vi.fn(),
  autopilotEnabled: (p: Preferences) => p.autopilot ?? true,
  themePreference: (p: Preferences) => p.theme ?? 'system',
}))
const sendStart = vi.hoisted(() => vi.fn())
vi.mock('../server/control.telefunc.js', () => ({ sendStart }))
// The `@` project picker loads over Telefunc; stub the RPC so this stays a unit test.
vi.mock('../server/projects.telefunc.js', () => ({ onProjects: () => Promise.resolve([]) }))
// The Composer's editor picker (#727) detects editors over Telefunc; stub it to none.
vi.mock('../lib/editors.js', () => ({ useDetectedEditors: () => [] }))

// Stub the Tiptap editor (needs a real DOM): an input driving onChange + a ref exposing clear/focus.
vi.mock('./PromptEditor.js', async () => {
  const { forwardRef, useImperativeHandle } = await import('react')
  const PromptEditor = forwardRef((props: any, ref: any) => {
    useImperativeHandle(ref, () => ({ clear: () => props.onChange(''), focus: () => {}, loadTemplate: () => {} }))
    return <input aria-label="prompt" onChange={e => props.onChange(e.target.value)} disabled={props.disabled} />
  })
  return { PromptEditor }
})

const { RunResumeChat } = await import('./RunResumeChat.js')

function renderChat(over: Partial<Parameters<typeof RunResumeChat>[0]> = {}) {
  const onRunStarted = vi.fn()
  render(
    <RunResumeChat
      projectId="p1"
      sessionId="sess-42"
      files={[]}
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

describe('RunResumeChat (#720)', () => {
  test('shows the "run ended" hint so the finished run is not a dead end', () => {
    renderChat()
    expect(screen.getByText(/run ended.*continues it/i)).toBeTruthy()
  })

  test('sending spins a resumed prompt run carrying the captured session id, then jumps to live', async () => {
    sendStart.mockResolvedValue({ ok: true })
    const { onRunStarted } = renderChat()
    fireEvent.change(screen.getByLabelText('prompt'), { target: { value: 'and now dark mode' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(sendStart).toHaveBeenCalledTimes(1))
    const [projectId, text, kind, options] = sendStart.mock.calls[0]!
    expect(projectId).toBe('p1')
    expect(text).toBe('and now dark mode')
    expect(kind).toBe('prompt') // a continuation is a prompt run
    expect(options.resumeSession).toBe('sess-42') // seeded with the finished run's session
    await waitFor(() => expect(onRunStarted).toHaveBeenCalledWith('and now dark mode', undefined))
  })

  test('surfaces the busy guard instead of jumping', async () => {
    sendStart.mockResolvedValue({ ok: false, busy: true })
    const { onRunStarted } = renderChat()
    fireEvent.change(screen.getByLabelText('prompt'), { target: { value: 'go' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(screen.getByText(/run is already active/i)).toBeTruthy())
    expect(onRunStarted).not.toHaveBeenCalled()
  })
})
