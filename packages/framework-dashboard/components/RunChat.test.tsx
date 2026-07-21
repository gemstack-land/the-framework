import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

// The two writes this component chooses between: a control-log message into the open session, or
// a run of its own.
const sendMessage = vi.hoisted(() => vi.fn())
const sendStart = vi.hoisted(() => vi.fn())
vi.mock('../server/control.telefunc.js', () => ({ sendMessage, sendStart }))

// The Composer is exercised by its own tests; here it only has to hand back the two submits, so
// stub it down to the one prop under test (#959).
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
    </div>
  ))
  return { Composer }
})

const { RunChat } = await import('./RunChat.js')

function renderChat(over: Partial<Parameters<typeof RunChat>[0]> = {}) {
  const onRunStarted = vi.fn()
  render(<RunChat projectId="p1" runId="run-1" files={[]} addContext={vi.fn()} onRunStarted={onRunStarted} {...over} />)
  return { onRunStarted }
}

beforeEach(() => {
  sendMessage.mockReset()
  sendStart.mockReset()
})
afterEach(cleanup)

describe('RunChat (#714)', () => {
  test('an ordinary submit goes into the open session as a message', async () => {
    sendMessage.mockResolvedValue(undefined)
    const { onRunStarted } = renderChat()
    fireEvent.click(screen.getByText('submit-normal'))
    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith('p1', 'hello', 'run-1'))
    expect(sendStart).not.toHaveBeenCalled()
    expect(onRunStarted).not.toHaveBeenCalled()
  })

  test('a new-session preset starts its own run instead of messaging this one (#959)', async () => {
    sendStart.mockResolvedValue({ ok: true, runId: 'run-2' })
    const { onRunStarted } = renderChat()
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
    const { onRunStarted } = renderChat()
    fireEvent.click(screen.getByText('submit-new-session'))
    await waitFor(() => expect(screen.getByText(/session is already active/i)).toBeTruthy())
    expect(onRunStarted).not.toHaveBeenCalled()
  })
})
