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
  // #842: the launcher strip reads the resolved layers; nothing here sets a repo tier.
  usePreferenceSources: () => ({}),
  useProjectFileConfig: () => ({}),
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
      runId="2026-07-19T10-00-00-000Z"
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
  test('shows the "session ended" hint so the finished session is not a dead end', () => {
    renderChat()
    expect(screen.getByText(/session ended.*continues it/i)).toBeTruthy()
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

  test('resumes on the run\'s own agent, not the global pref (#831)', async () => {
    sendStart.mockResolvedValue({ ok: true })
    // The pref says Codex, but this run ran under Claude. Handing its session id to `codex --resume`
    // would be meaningless, so the run's driver wins.
    prefs = { agent: 'codex', model: 'gpt-5' }
    renderChat({ driver: 'claude-code' })
    fireEvent.change(screen.getByLabelText('prompt'), { target: { value: 'carry on' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(sendStart).toHaveBeenCalledTimes(1))
    const options = sendStart.mock.calls[0]![3]
    expect(options.agent).toBeUndefined() // claude is the default, so no --agent flag
    expect(options.model).toBeUndefined() // the resumed transcript keeps the model it had
  })

  test('a codex run resumes on codex (#831)', async () => {
    sendStart.mockResolvedValue({ ok: true })
    prefs = { agent: 'claude' }
    renderChat({ driver: 'codex' })
    fireEvent.change(screen.getByLabelText('prompt'), { target: { value: 'carry on' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(sendStart).toHaveBeenCalledTimes(1))
    expect(sendStart.mock.calls[0]![3].agent).toBe('codex')
  })

  test('offers no agent/model select, since a session cannot change agent (#831)', () => {
    prefs = { agent: 'claude' }
    renderChat({ driver: 'claude-code' })
    expect(screen.queryByTitle(/Agent:/)).toBeNull()
  })

  test('surfaces the busy guard instead of jumping', async () => {
    sendStart.mockResolvedValue({ ok: false, busy: true })
    const { onRunStarted } = renderChat()
    fireEvent.change(screen.getByLabelText('prompt'), { target: { value: 'go' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(screen.getByText(/session is already active/i)).toBeTruthy())
    expect(onRunStarted).not.toHaveBeenCalled()
  })
})
