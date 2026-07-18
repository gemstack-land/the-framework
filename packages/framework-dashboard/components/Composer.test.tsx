import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { Preferences } from '@gemstack/framework'

// Preferences are the shared daemon store; stub them so the composer reads a fixed value.
const updatePreferences = vi.hoisted(() => vi.fn())
let prefs: Preferences = {}
vi.mock('../lib/preferences.js', () => ({
  usePreferences: () => prefs,
  updatePreferences,
  autopilotEnabled: (p: Preferences) => p.autopilot ?? true,
  themePreference: (p: Preferences) => p.theme ?? 'system',
}))

// Stub the Tiptap editor (it needs a real DOM/ProseMirror): a plain input driving onChange, a
// "type-submit" button firing onSubmit, and a ref exposing the same handle the composer calls.
vi.mock('./PromptEditor.js', async () => {
  const { forwardRef, useImperativeHandle } = await import('react')
  const PromptEditor = forwardRef((props: any, ref: any) => {
    useImperativeHandle(ref, () => ({ clear: () => props.onChange(''), focus: () => {}, loadTemplate: () => {} }))
    return (
      <div>
        <input aria-label="prompt" onChange={e => props.onChange(e.target.value)} disabled={props.disabled} />
        <button type="button" onClick={() => props.onSubmit()}>
          editor-submit
        </button>
      </div>
    )
  })
  return { PromptEditor }
})

const { Composer } = await import('./Composer.js')

function renderComposer(over: Partial<Parameters<typeof Composer>[0]> = {}) {
  const onSubmit = vi.fn()
  render(
    <Composer
      projects={[]}
      files={[]}
      addContext={vi.fn()}
      onSubmit={onSubmit}
      busy={false}
      submitLabel="Send"
      submitBusyLabel="Sending…"
      {...over}
    />,
  )
  return { onSubmit }
}

beforeEach(() => {
  prefs = {}
  updatePreferences.mockReset()
})
afterEach(cleanup)

describe('Composer (#721)', () => {
  test('renders the full control row: agent/model, presets, options gear, and the submit button', () => {
    renderComposer({ submitLabel: 'Start run' })
    expect(screen.getByText('Presets')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Run options' })).toBeTruthy()
    expect(screen.getByTitle(/Agent: Claude Code/)).toBeTruthy() // the agent/model trigger
    expect(screen.getByRole('button', { name: /Start run/ })).toBeTruthy()
  })

  test('the submit button is disabled until the editor has text, then fires onSubmit', () => {
    const { onSubmit } = renderComposer()
    const submit = screen.getByRole('button', { name: 'Send' })
    expect(submit.hasAttribute('disabled')).toBe(true)
    fireEvent.change(screen.getByLabelText('prompt'), { target: { value: 'ship it' } })
    expect(submit.hasAttribute('disabled')).toBe(false)
    fireEvent.click(submit)
    expect(onSubmit).toHaveBeenCalledWith('ship it', 'build')
  })

  test('the editor shortcut (Cmd/Ctrl+Enter) submits too', () => {
    const { onSubmit } = renderComposer()
    fireEvent.change(screen.getByLabelText('prompt'), { target: { value: 'go' } })
    fireEvent.click(screen.getByText('editor-submit'))
    expect(onSubmit).toHaveBeenCalledWith('go', 'build')
  })

  test('mirrors prompt changes out via onPromptChange', () => {
    const onPromptChange = vi.fn()
    renderComposer({ onPromptChange })
    fireEvent.change(screen.getByLabelText('prompt'), { target: { value: 'hi' } })
    expect(onPromptChange).toHaveBeenLastCalledWith('hi', 'build')
  })
})
