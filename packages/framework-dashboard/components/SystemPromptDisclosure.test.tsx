import { afterEach, describe, expect, test } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { SystemPromptDisclosure } from './SystemPromptDisclosure.js'

afterEach(cleanup)

// Open the "Actual prompt" disclosure so its body renders.
function openDisclosure() {
  fireEvent.click(screen.getByText('Actual prompt'))
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
    expect(screen.queryByText(/The system prompt is off/)).toBeNull()
    expect(screen.getByText(/whole system prompt/)).toBeTruthy()
  })

  test('under transparent, the preview is empty — the prompt is sent as written', () => {
    render(<SystemPromptDisclosure {...baseProps} disabled={false} transparent />)
    openDisclosure()
    // Transparent empties the whole channel (protocols included), so the "off" branch renders.
    expect(screen.getByText(/your prompt is sent to the agent exactly as you wrote it/)).toBeTruthy()
  })
})
