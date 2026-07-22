import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const sendDeleteSession = vi.hoisted(() => vi.fn())
vi.mock('../server/control.telefunc.js', () => ({ sendDeleteSession }))

const { DeleteSessionButton } = await import('./DeleteSessionButton.js')

function renderButton(over: Partial<Parameters<typeof DeleteSessionButton>[0]> = {}) {
  const onDeleted = vi.fn()
  render(<DeleteSessionButton projectId="p1" runId="run-1" label="update index.html" onDeleted={onDeleted} {...over} />)
  return { onDeleted }
}

beforeEach(() => sendDeleteSession.mockReset())
afterEach(cleanup)

describe('DeleteSessionButton (#1032)', () => {
  test('the trigger alone does not delete — it opens a confirm first', () => {
    renderButton()
    fireEvent.click(screen.getByLabelText('Delete this session'))
    // The confirm names the session and is honest about what survives.
    expect(screen.getByText('Delete this session?')).toBeTruthy()
    expect(screen.getByText(/update index\.html/)).toBeTruthy()
    expect(screen.getByText(/branch and any pull request stay/i)).toBeTruthy()
    // Nothing has been deleted by merely opening it.
    expect(sendDeleteSession).not.toHaveBeenCalled()
  })

  test('confirming deletes the session and then leaves it', async () => {
    sendDeleteSession.mockResolvedValue({ ok: true })
    const { onDeleted } = renderButton()
    fireEvent.click(screen.getByLabelText('Delete this session'))
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(sendDeleteSession).toHaveBeenCalledWith('p1', 'run-1'))
    await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1))
  })

  test('cancelling deletes nothing', () => {
    renderButton()
    fireEvent.click(screen.getByLabelText('Delete this session'))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(sendDeleteSession).not.toHaveBeenCalled()
  })

  test('a failed delete surfaces the reason and does not leave the session', async () => {
    sendDeleteSession.mockResolvedValue({ ok: false, error: 'that session is still going; stop it before deleting it' })
    const { onDeleted } = renderButton()
    fireEvent.click(screen.getByLabelText('Delete this session'))
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(screen.getByText(/still going; stop it/)).toBeTruthy())
    expect(onDeleted).not.toHaveBeenCalled()
  })
})
