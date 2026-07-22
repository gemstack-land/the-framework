import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { Preferences } from '@gemstack/framework'

// Preferences are the shared daemon store; stub them so the composer reads a fixed value.
const updatePreferences = vi.hoisted(() => vi.fn())
let prefs: Preferences = {}
vi.mock('../lib/preferences.js', () => ({
  usePreferences: () => prefs,
  updatePreferences,
  autopilotEnabled: (p: Preferences) => p.autopilot ?? true,
  themePreference: (p: Preferences) => p.theme ?? 'system',
  // #842: the launcher strip reads the resolved layers; nothing here sets a repo tier.
  usePreferenceSources: () => ({}),
  useProjectFileConfig: () => ({}),
  // #1025: project presets; nothing here opens a project, so no shared presets and no project scope.
  useProjectPresets: () => [],
  saveProjectPresetList: vi.fn(),
  useActiveProjectId: () => null,
}))
// The editor picker (#727) detects installed editors over Telefunc; stub it to none in the test.
vi.mock('../lib/editors.js', () => ({ useDetectedEditors: () => [] }))
// Composer loads its own projects for the `@` picker (#743); stub the read to none.
vi.mock('../server/projects.telefunc.js', () => ({ onProjects: () => Promise.resolve([]) }))

// Stub the Tiptap editor (it needs a real DOM/ProseMirror): a plain input driving onChange, a
// "type-submit" button firing onSubmit, and a ref exposing the same handle the composer calls.
vi.mock('./PromptEditor.js', async () => {
  const { forwardRef, useImperativeHandle } = await import('react')
  const PromptEditor = forwardRef((props: any, ref: any) => {
    useImperativeHandle(ref, () => ({
      clear: () => props.onChange(''),
      focus: () => {},
      // Loading a preset puts its text in the box, which is what makes a loaded preset submittable.
      loadTemplate: (text: string) => {
        props.onChange(text)
        return false
      },
    }))
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
  test('renders the full control row: agent/model, options gear, and the submit button', () => {
    renderComposer({ submitLabel: 'Start session' })
    // Presets have a visible surface again (#948): the `/` menu stays the fast path, the
    // button is the discoverable one.
    expect(screen.getByRole('button', { name: /Presets/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Session options' })).toBeTruthy()
    expect(screen.getByTitle(/Agent: Claude Code/)).toBeTruthy() // the agent/model trigger
    // The submit button appears only once the prompt has text (#721).
    fireEvent.change(screen.getByLabelText('prompt'), { target: { value: 'x' } })
    expect(screen.getByRole('button', { name: /Start session/ })).toBeTruthy()
  })

  test('compact (#723) keeps the agent/model + options controls (#755)', () => {
    const { onSubmit } = renderComposer({ compact: true, submitLabel: 'Start' })
    // They used to be dropped here, which meant a navbar run silently used the stored agent,
    // model and options with nothing on screen saying which.
    expect(screen.queryByRole('button', { name: 'Session options' })).not.toBeNull()
    expect(screen.queryByTitle(/Agent: Claude Code/)).not.toBeNull()
    // The editor + submit still work (so `/` `<` `@` `#` triggers remain live in the editor).
    fireEvent.change(screen.getByLabelText('prompt'), { target: { value: 'quick run' } })
    fireEvent.click(screen.getByRole('button', { name: 'Start' }))
    expect(onSubmit).toHaveBeenCalledWith('quick run', 'build', { newSession: false })
  })

  test('showAgentModel={false} (#831) drops the agent/model select, keeping the rest of the row', () => {
    const { onSubmit } = renderComposer({ showAgentModel: false })
    // An in-session composer: the session is bound to the agent it started with, so offering the
    // select there would only ever rewrite the next session's default.
    expect(screen.queryByTitle(/Agent:/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Session options' })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('prompt'), { target: { value: 'follow-up' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(onSubmit).toHaveBeenCalledWith('follow-up', 'build', { newSession: false })
  })

  test('option labels promise only what the code delivers (#801)', () => {
    prefs = { onBeforeMergeableQuality: true }
    renderComposer()
    fireEvent.click(screen.getByRole('button', { name: 'Session options' }))
    // Autopilot no longer claims to relax the maintenance stance: #556 took that section out of the
    // prompt, leaving the countdown as the whole feature. Scoped to the menu: the same label is on
    // the resolved-options strip (#842), which carries its own "where it came from" title.
    const menu = screen.getByRole('menu')
    const autopilot = within(menu).getByText('Autopilot').closest('[title]')
    expect(autopilot?.getAttribute('title')).not.toMatch(/maintenance/i)
    expect(autopilot?.getAttribute('title')).toMatch(/countdown/i)
  })

  test('Browser is disabled with a reason off Claude Code (#801)', () => {
    prefs = { agent: 'codex', browser: true }
    renderComposer()
    fireEvent.click(screen.getByRole('button', { name: 'Session options' }))
    // The browser rides Claude Code's MCP config, so under Codex the box was checkable and inert.
    expect(screen.getByText(/only on Claude Code/)).toBeTruthy()
  })

  test('Auto maintenance is gated on Post-merge cleanup (#801)', () => {
    // It trims the post-merge prompt, so with that pass off it drops nothing.
    prefs = { eco: true, ecoMaintenance: true, onBeforeMergeableQuality: false }
    renderComposer()
    fireEvent.click(screen.getByRole('button', { name: 'Session options' }))
    expect(screen.getByText(/only applies while Post-merge cleanup is on/)).toBeTruthy()
  })

  test('the submit button is hidden until the editor has text, then appears and fires onSubmit', () => {
    const { onSubmit } = renderComposer()
    // Empty prompt: nothing to send, so the button is not in the DOM (#721).
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull()
    fireEvent.change(screen.getByLabelText('prompt'), { target: { value: 'ship it' } })
    const submit = screen.getByRole('button', { name: 'Send' })
    expect(submit.hasAttribute('disabled')).toBe(false)
    fireEvent.click(submit)
    expect(onSubmit).toHaveBeenCalledWith('ship it', 'build', { newSession: false })
  })

  test('the editor shortcut (Cmd/Ctrl+Enter) submits too', () => {
    const { onSubmit } = renderComposer()
    fireEvent.change(screen.getByLabelText('prompt'), { target: { value: 'go' } })
    fireEvent.click(screen.getByText('editor-submit'))
    expect(onSubmit).toHaveBeenCalledWith('go', 'build', { newSession: false })
  })

  test('mirrors prompt changes out via onPromptChange', () => {
    const onPromptChange = vi.fn()
    renderComposer({ onPromptChange })
    fireEvent.change(screen.getByLabelText('prompt'), { target: { value: 'hi' } })
    expect(onPromptChange).toHaveBeenLastCalledWith('hi', 'build')
  })

  // #959: a preset can declare that it never belongs in the open session. The Composer does not
  // act on that itself — it carries the flag out to the host, which is the only thing that knows
  // whether "new session" means anything on its surface.
  test('a new-session preset marks its submit, and a normal one does not (#959)', () => {
    const { onSubmit } = renderComposer()
    fireEvent.click(screen.getByRole('button', { name: /Presets/ }))
    fireEvent.click(screen.getByText('Import tickets from GitHub'))
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(onSubmit).toHaveBeenCalledWith('Import tickets from GitHub', 'prompt', { newSession: true })

    cleanup()
    const second = renderComposer()
    fireEvent.click(screen.getByRole('button', { name: /Presets/ }))
    fireEvent.click(screen.getByText('Security audit'))
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(second.onSubmit).toHaveBeenCalledWith(expect.stringContaining('Security audit'), 'prompt', { newSession: false })
  })

  test('emptying the box drops the preset\'s new-session rule with the preset (#959)', () => {
    const { onSubmit } = renderComposer()
    fireEvent.click(screen.getByRole('button', { name: /Presets/ }))
    fireEvent.click(screen.getByText('Import tickets from GitHub'))
    // The stub editor does not mirror the loaded text into the DOM input, and jsdom drops a
    // change event whose value did not actually change — so give it something to clear.
    fireEvent.change(screen.getByLabelText('prompt'), { target: { value: 'edited' } })
    // Clearing it back to a typed prompt is a fresh start: a plain build run, in this session.
    fireEvent.change(screen.getByLabelText('prompt'), { target: { value: '' } })
    fireEvent.change(screen.getByLabelText('prompt'), { target: { value: 'just a question' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(onSubmit).toHaveBeenCalledWith('just a question', 'build', { newSession: false })
  })
})
