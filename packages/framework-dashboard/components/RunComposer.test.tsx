import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { Preferences } from '@gemstack/the-framework'

// The two writes this component chooses between: a control-log message into the open session, or
// a run of its own.
const sendMessage = vi.hoisted(() => vi.fn())
const sendStart = vi.hoisted(() => vi.fn())
vi.mock('../server/control.telefunc.js', () => ({ sendMessage, sendStart }))

// The agent pref, to prove a continuation ignores it (#831).
let prefs: Preferences = {}
vi.mock('../lib/preferences.js', () => ({
  usePreferences: () => prefs,
  updatePreferences: vi.fn(),
  autopilotEnabled: (p: Preferences) => p.autopilot ?? true,
  themePreference: (p: Preferences) => p.theme ?? 'system',
  usePreferenceSources: () => ({}),
  useProjectFileConfig: () => ({}),
}))

// The Composer is exercised by its own tests; here it only has to hand back the two submits and
// report the props this component sets on it.
vi.mock('./Composer.js', async () => {
  const { forwardRef } = await import('react')
  const Composer = forwardRef((props: any, _ref: any) => (
    <div>
      <button type="button" disabled={props.busy} onClick={() => props.onSubmit('hello', 'build', { newSession: false })}>
        submit-normal
      </button>
      <button type="button" disabled={props.busy} onClick={() => props.onSubmit('Import tickets from GitHub', 'prompt', { newSession: true })}>
        submit-new-session
      </button>
      <span data-testid="composer-props">
        {JSON.stringify({ showAgentModel: props.showAgentModel, busyLabel: props.submitBusyLabel, placeholder: props.placeholder })}
      </span>
    </div>
  ))
  return { Composer }
})

const { RunComposer } = await import('./RunComposer.js')

function renderComposer(over: Partial<Parameters<typeof RunComposer>[0]> = {}) {
  const onRunStarted = vi.fn()
  render(
    <RunComposer projectId="p1" runId="run-1" live files={[]} addContext={vi.fn()} onRunStarted={onRunStarted} {...over} />,
  )
  return { onRunStarted }
}

const props = (): { showAgentModel: boolean; busyLabel: string; placeholder: string } =>
  JSON.parse(screen.getByTestId('composer-props').textContent ?? '{}')

beforeEach(() => {
  prefs = {}
  sendMessage.mockReset()
  sendStart.mockReset()
})
afterEach(cleanup)

describe('RunComposer, live (#714)', () => {
  test('an ordinary submit goes into the open session as a message', async () => {
    sendMessage.mockResolvedValue(undefined)
    const { onRunStarted } = renderComposer()
    fireEvent.click(screen.getByText('submit-normal'))
    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith('p1', 'hello', 'run-1'))
    expect(sendStart).not.toHaveBeenCalled()
    expect(onRunStarted).not.toHaveBeenCalled()
  })

  test('a new-session preset starts its own run instead of messaging this one (#959)', async () => {
    sendStart.mockResolvedValue({ ok: true, runId: 'run-2' })
    const { onRunStarted } = renderComposer()
    fireEvent.click(screen.getByText('submit-new-session'))
    await waitFor(() => expect(sendStart).toHaveBeenCalledTimes(1))
    // Not a message: the open session never sees it.
    expect(sendMessage).not.toHaveBeenCalled()
    const [projectId, text, kind, options] = sendStart.mock.calls[0]!
    expect(projectId).toBe('p1')
    expect(text).toBe('Import tickets from GitHub')
    expect(kind).toBe('prompt')
    // No continueRunId: a continuation would put it back on this session's branch (#762).
    expect(options.continueRunId).toBeUndefined()
    expect(options.resumeSession).toBeUndefined()
    // And the view follows the run it just started, or the user would be left watching the old one.
    await waitFor(() => expect(onRunStarted).toHaveBeenCalledWith('Import tickets from GitHub', 'run-2'))
  })

  test('a refused start surfaces the reason and does not navigate (#959)', async () => {
    sendStart.mockResolvedValue({ ok: false, busy: true })
    const { onRunStarted } = renderComposer()
    fireEvent.click(screen.getByText('submit-new-session'))
    await waitFor(() => expect(screen.getByText(/session is already active/i)).toBeTruthy())
    expect(onRunStarted).not.toHaveBeenCalled()
  })
})

describe('RunComposer, finished (#720)', () => {
  const ended = { live: false, sessionId: 'sess-42' }

  test('says the session can be resumed rather than leaving it a dead end', () => {
    renderComposer({ ...ended, outcome: { ok: false, stopped: true } })
    expect(screen.getByText(/session stopped.*resumes it/i)).toBeTruthy()
  })

  test('sending spins a resumed prompt run carrying the captured session id, then jumps to it', async () => {
    sendStart.mockResolvedValue({ ok: true })
    const { onRunStarted } = renderComposer(ended)
    fireEvent.click(screen.getByText('submit-normal'))
    await waitFor(() => expect(sendStart).toHaveBeenCalledTimes(1))
    const [projectId, text, kind, options] = sendStart.mock.calls[0]!
    expect(projectId).toBe('p1')
    expect(text).toBe('hello')
    expect(kind).toBe('prompt') // a continuation is a prompt run
    expect(options.resumeSession).toBe('sess-42') // seeded with the finished run's session
    expect(options.continueRunId).toBe('run-1') // and written into the same run (#762)
    expect(sendMessage).not.toHaveBeenCalled() // there is no process left to message
    await waitFor(() => expect(onRunStarted).toHaveBeenCalledWith('hello', undefined))
  })

  test("resumes on the run's own agent, not the global pref (#831)", async () => {
    sendStart.mockResolvedValue({ ok: true })
    // The pref says Codex, but this run ran under Claude. Handing its session id to `codex --resume`
    // would be meaningless, so the run's driver wins.
    prefs = { agent: 'codex', model: 'gpt-5' }
    renderComposer({ ...ended, driver: 'claude-code' })
    fireEvent.click(screen.getByText('submit-normal'))
    await waitFor(() => expect(sendStart).toHaveBeenCalledTimes(1))
    const options = sendStart.mock.calls[0]![3]
    expect(options.agent).toBeUndefined() // claude is the default, so no --agent flag
    expect(options.model).toBeUndefined() // the resumed transcript keeps the model it had
  })

  test('a codex run resumes on codex (#831)', async () => {
    sendStart.mockResolvedValue({ ok: true })
    prefs = { agent: 'claude' }
    renderComposer({ ...ended, driver: 'codex' })
    fireEvent.click(screen.getByText('submit-normal'))
    await waitFor(() => expect(sendStart).toHaveBeenCalledTimes(1))
    expect(sendStart.mock.calls[0]![3].agent).toBe('codex')
  })

  test('offers no agent/model select, since a session cannot change agent (#831)', () => {
    renderComposer({ ...ended, driver: 'claude-code' })
    expect(props().showAgentModel).toBe(false)
  })

  test('surfaces the busy guard instead of jumping', async () => {
    sendStart.mockResolvedValue({ ok: false, busy: true })
    const { onRunStarted } = renderComposer(ended)
    fireEvent.click(screen.getByText('submit-normal'))
    await waitFor(() => expect(screen.getByText(/session is already active/i)).toBeTruthy())
    expect(onRunStarted).not.toHaveBeenCalled()
  })
})

describe('RunComposer, finished with no session id (#1026)', () => {
  test('stays, and says the send starts a new session instead of vanishing', () => {
    renderComposer({ live: false })
    // The dead-end note used to replace the composer entirely, so a run that stopped early left
    // nowhere to type. It is now the placeholder rather than a note above the box: the message is
    // about what typing here does, so it is said where you type — and only once.
    expect(props().placeholder).toMatch(/can’t be continued/i)
    // And only there: no note paragraph above the box repeating it (the note is the only <p> this
    // component renders, short of an error alert).
    expect(document.querySelector('p')).toBeNull()
    expect(screen.getByText('submit-normal')).toBeTruthy()
    expect(props().busyLabel).toBe('Starting…')
  })

  test('sending starts a fresh run with the text, since there is nothing to resume', async () => {
    sendStart.mockResolvedValue({ ok: true, runId: 'run-9' })
    const { onRunStarted } = renderComposer({ live: false })
    fireEvent.click(screen.getByText('submit-normal'))
    await waitFor(() => expect(sendStart).toHaveBeenCalledTimes(1))
    const options = sendStart.mock.calls[0]![3]
    expect(options.resumeSession).toBeUndefined()
    expect(options.continueRunId).toBeUndefined()
    expect(sendMessage).not.toHaveBeenCalled()
    await waitFor(() => expect(onRunStarted).toHaveBeenCalledWith('hello', 'run-9'))
  })
})
