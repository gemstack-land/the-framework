import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { SystemPromptDisclosure } from './SystemPromptDisclosure.js'

afterEach(cleanup)

// Open the "Enhanced System Prompt" disclosure so its body renders.
function openDisclosure() {
  fireEvent.click(screen.getByText(/Enhanced System Prompt/))
}

/** The summary line, whose dot + screen-reader text carry the state (#863). */
function summary(): string {
  return screen.getAllByRole('button')[0]?.textContent ?? ''
}

const baseProps = {
  prompt: 'build me a thing',
  onDisabledChange: () => {},
  autopilot: false,
  eco: undefined,
  context: [],
  busy: false,
}

describe('SystemPromptDisclosure transparent mode (#625)', () => {
  test('with the built-in prompt on, the preview shows the wrapped system prompt', () => {
    render(<SystemPromptDisclosure {...baseProps} disabled={false} />)
    openDisclosure()
    // The real composeRunSystem output is shown; it is a non-empty system channel.
    expect(screen.queryByText(/No extra system prompt/)).toBeNull()
    expect(screen.getByText(/whole system prompt/)).toBeTruthy()
  })

  test('under transparent, the preview is empty — the prompt is sent as written', () => {
    render(<SystemPromptDisclosure {...baseProps} disabled={false} transparent />)
    openDisclosure()
    // Transparent empties the whole channel (protocols included), so the "off" branch renders.
    expect(screen.getByText(/only the built-in system prompt of your AI model provider/)).toBeTruthy()
  })
})

describe('Enhanced System Prompt summary (#863)', () => {
  test('reads as fully enabled only when every axis is on', () => {
    render(<SystemPromptDisclosure {...baseProps} disabled={false} />)
    expect(summary()).toContain('fully enabled')
    expect(summary()).not.toContain('not fully enabled')
  })

  test('not fully enabled when the built-in block is off, even though the protocols still ship', () => {
    render(<SystemPromptDisclosure {...baseProps} disabled />)
    expect(summary()).toContain('not fully enabled')
    openDisclosure()
    // Not "completely enabled", but the channel is not empty either.
    expect(screen.queryByText(/No extra system prompt/)).toBeNull()
  })

  test('not fully enabled when the framework integration is off', () => {
    render(<SystemPromptDisclosure {...baseProps} disabled={false} transparent />)
    expect(summary()).toContain('not fully enabled')
  })

  test('the state is not carried by the dot alone', () => {
    render(<SystemPromptDisclosure {...baseProps} disabled={false} />)
    expect(summary()).toContain('fully enabled')
  })
})

describe('Enhanced System Prompt fine-grained options (#863)', () => {
  const antiLazy = () => screen.getByLabelText(/Anti-laziness/) as HTMLInputElement
  const integration = () => screen.getByLabelText(/Integration with The Framework/) as HTMLInputElement

  test('both rows read as on by default', () => {
    render(<SystemPromptDisclosure {...baseProps} disabled={false} onTransparentChange={() => {}} />)
    openDisclosure()
    expect(antiLazy().checked).toBe(true)
    expect(integration().checked).toBe(true)
  })

  // The row is the axis, not the flag behind it: unticking it disables the prompt.
  test('unticking anti-laziness disables the built-in prompt', () => {
    const onDisabledChange = vi.fn()
    render(<SystemPromptDisclosure {...baseProps} disabled={false} onDisabledChange={onDisabledChange} />)
    openDisclosure()
    fireEvent.click(antiLazy())
    expect(onDisabledChange).toHaveBeenCalledWith(true)
  })

  test('unticking the integration turns transparent mode on', () => {
    const onTransparentChange = vi.fn()
    render(<SystemPromptDisclosure {...baseProps} disabled={false} onTransparentChange={onTransparentChange} />)
    openDisclosure()
    fireEvent.click(integration())
    expect(onTransparentChange).toHaveBeenCalledWith(true)
  })

  // Transparent is the master off-switch (#625), so the rows must not claim otherwise.
  test('transparent shows anti-laziness as off and locked, whatever vanilla says', () => {
    render(<SystemPromptDisclosure {...baseProps} disabled={false} transparent onTransparentChange={() => {}} />)
    openDisclosure()
    expect(antiLazy().checked).toBe(false)
    expect(antiLazy().disabled).toBe(true)
    expect(integration().checked).toBe(false)
  })

  test('the integration row is read-only when the caller cannot switch it', () => {
    render(<SystemPromptDisclosure {...baseProps} disabled={false} />)
    openDisclosure()
    expect(integration().disabled).toBe(true)
  })
})

// #863 asks for the ENTIRE prompt, and the browser section is part of what the run sends.
describe('Enhanced System Prompt covers the browser section (#863)', () => {
  test('the browser run shows a longer prompt than the same run without it', () => {
    const { unmount } = render(<SystemPromptDisclosure {...baseProps} disabled={false} />)
    openDisclosure()
    const plain = document.querySelector('pre')?.textContent ?? ''
    unmount()

    render(<SystemPromptDisclosure {...baseProps} disabled={false} browser />)
    openDisclosure()
    const withBrowser = document.querySelector('pre')?.textContent ?? ''
    expect(plain.length).toBeGreaterThan(0)
    expect(withBrowser.length).toBeGreaterThan(plain.length)
  })
})
