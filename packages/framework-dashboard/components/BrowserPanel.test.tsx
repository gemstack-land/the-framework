import { afterEach, describe, expect, test } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { BrowserPanel } from './BrowserPanel.js'

afterEach(cleanup)

const frame = () => screen.getByAltText("The run's browser")

describe('BrowserPanel failure recovery (#946)', () => {
  test('an img error shows the message with a Retry, and Retry restores the stream', () => {
    render(<BrowserPanel projectId="p" runId="r1" />)
    fireEvent.error(frame())
    expect(screen.queryByAltText("The run's browser")).toBeNull()
    expect(screen.getByText(/not reachable/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /Retry/ }))
    // The stream is back, on a distinct URL so the browser re-issues the request
    // instead of replaying the failed one.
    expect(frame().getAttribute('src')).toContain('r=1')
    expect(screen.queryByRole('button', { name: /Retry/ })).toBeNull()
  })

  test('a retry that fails again latches only that attempt, and can retry again', () => {
    render(<BrowserPanel projectId="p" runId="r1" />)
    fireEvent.error(frame())
    fireEvent.click(screen.getByRole('button', { name: /Retry/ }))
    fireEvent.error(frame())
    expect(screen.getByText(/not reachable/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Retry/ }))
    expect(frame().getAttribute('src')).toContain('r=2')
  })

  test('a failure on one run does not latch for the next run (#946)', () => {
    const { rerender } = render(<BrowserPanel projectId="p" runId="r1" />)
    fireEvent.error(frame())
    expect(screen.getByText(/not reachable/)).toBeTruthy()

    // The parent switches runs without remounting: the failure belonged to the old stream,
    // so the new run must start clean rather than inherit "not reachable" (the old latch
    // only ever cleared by the accident of a remount).
    rerender(<BrowserPanel projectId="p" runId="r2" />)
    expect(frame().getAttribute('src')).toContain('/browser/p/r2/stream')
  })
})
