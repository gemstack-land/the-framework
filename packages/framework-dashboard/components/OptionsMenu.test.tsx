import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { OptionRow } from './OptionsMenu.js'

const updatePreferences = vi.hoisted(() => vi.fn())
vi.mock('../lib/preferences.js', () => ({ updatePreferences }))

const { OptionsMenu } = await import('./OptionsMenu.js')

afterEach(() => {
  cleanup()
  updatePreferences.mockReset()
})

const mainOptions = (): OptionRow[] => [
  { key: 'autopilot', label: 'Autopilot', title: 't', checked: false },
  { key: 'eco', label: 'Eco', title: 't', checked: true },
]
const ecoOptions = (): OptionRow[] => [{ key: 'ecoPlanning', label: 'Auto planning', title: 't', checked: false }]

// The editor props (#727) are required; default them so the existing cases stay focused.
const editorProps = { editor: undefined as string | undefined, editors: [], onEditorChange: () => {} }

function open() {
  fireEvent.click(screen.getByRole('button', { name: /run options/i }))
}

describe('OptionsMenu (#654)', () => {
  test('the trigger badges how many options are on', () => {
    render(<OptionsMenu options={mainOptions()} ecoOptions={ecoOptions()} showEco={false} busy={false} {...editorProps} theme="system" onThemeChange={() => {}} />)
    // Only Eco is checked -> the gear trigger shows a corner badge "1".
    expect(screen.getByRole('button', { name: /run options/i }).textContent).toContain('1')
  })

  test('toggling an item writes the new value through', () => {
    render(<OptionsMenu options={mainOptions()} ecoOptions={ecoOptions()} showEco={false} busy={false} {...editorProps} theme="system" onThemeChange={() => {}} />)
    open()
    fireEvent.click(screen.getByText('Autopilot'))
    expect(updatePreferences).toHaveBeenCalledWith({ autopilot: true })
  })

  test('hides the Eco sub-drops when Eco does not apply', () => {
    render(<OptionsMenu options={mainOptions()} ecoOptions={ecoOptions()} showEco={false} busy={false} {...editorProps} theme="system" onThemeChange={() => {}} />)
    open()
    expect(screen.queryByText('Auto planning')).toBeNull()
  })

  test('shows the Eco sub-drops when Eco applies', () => {
    render(<OptionsMenu options={mainOptions()} ecoOptions={ecoOptions()} showEco={true} busy={false} {...editorProps} theme="system" onThemeChange={() => {}} />)
    open()
    expect(screen.getByText('Auto planning')).toBeTruthy()
  })

  test('picking a theme calls onThemeChange with the chosen value (#725)', () => {
    const onThemeChange = vi.fn()
    render(
      <OptionsMenu
        options={mainOptions()}
        ecoOptions={ecoOptions()}
        showEco={false}
        busy={false}
        {...editorProps}
        theme="system"
        onThemeChange={onThemeChange}
      />,
    )
    open()
    fireEvent.click(screen.getByText('Dark'))
    expect(onThemeChange).toHaveBeenCalledWith('dark')
  })
})

describe('OptionsMenu editor picker (#727)', () => {
  const editors = [
    { bin: 'code', label: 'VS Code' },
    { bin: 'cursor', label: 'Cursor' },
  ]

  test('picking a detected editor sends its CLI bin', () => {
    const onEditorChange = vi.fn()
    render(
      <OptionsMenu
        options={mainOptions()}
        ecoOptions={ecoOptions()}
        showEco={false}
        busy={false}
        editor={undefined}
        editors={editors}
        onEditorChange={onEditorChange}
        theme="system"
        onThemeChange={() => {}}
      />,
    )
    open()
    fireEvent.click(screen.getByText('Cursor'))
    expect(onEditorChange).toHaveBeenCalledWith('cursor')
  })

  test('picking Default clears the editor (undefined)', () => {
    const onEditorChange = vi.fn()
    render(
      <OptionsMenu
        options={mainOptions()}
        ecoOptions={ecoOptions()}
        showEco={false}
        busy={false}
        editor="cursor"
        editors={editors}
        onEditorChange={onEditorChange}
        theme="system"
        onThemeChange={() => {}}
      />,
    )
    open()
    fireEvent.click(screen.getByText('Default'))
    expect(onEditorChange).toHaveBeenCalledWith(undefined)
  })

  test('shows a stored editor that was not auto-detected as a custom row', () => {
    render(
      <OptionsMenu
        options={mainOptions()}
        ecoOptions={ecoOptions()}
        showEco={false}
        busy={false}
        editor="mate"
        editors={editors}
        onEditorChange={() => {}}
        theme="system"
        onThemeChange={() => {}}
      />,
    )
    open()
    // The custom bin appears (as both its own label and description), selectable like the rest.
    expect(screen.getAllByText('mate').length).toBeGreaterThan(0)
  })
})

describe('OptionsMenu saved presets (#722)', () => {
  const base = () => ({ options: mainOptions(), ecoOptions: ecoOptions(), showEco: false, busy: false, ...editorProps, theme: 'system' as const, onThemeChange: () => {} })

  test('deletes a saved preset by id', () => {
    const onDeleteCustomPreset = vi.fn()
    render(<OptionsMenu {...base()} customPresets={[{ id: 'a', label: 'Deep review', prompt: 'x' }]} onDeleteCustomPreset={onDeleteCustomPreset} />)
    open()
    fireEvent.click(screen.getByRole('button', { name: 'Delete preset Deep review' }))
    expect(onDeleteCustomPreset).toHaveBeenCalledWith('a')
  })

  test('omits the "Your presets" section when there are none', () => {
    render(<OptionsMenu {...base()} customPresets={[]} onDeleteCustomPreset={() => {}} />)
    open()
    expect(screen.queryByText('Your presets')).toBeNull()
  })
})
