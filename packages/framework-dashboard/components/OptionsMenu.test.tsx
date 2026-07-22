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

function open() {
  fireEvent.click(screen.getByRole('button', { name: /session options/i }))
}

describe('OptionsMenu (#654)', () => {
  test('the trigger marks that options are on with a dot (#1046)', () => {
    render(<OptionsMenu options={mainOptions()} ecoOptions={ecoOptions()} showEco={false} busy={false} />)
    const trigger = screen.getByRole('button', { name: /session options/i })
    // A presence dot now, not a number: the count lives in the title for a11y, the dot in the corner.
    expect(trigger.getAttribute('title')).toMatch(/\bon$/)
    expect(trigger.querySelector('span.rounded-full')).not.toBeNull()
    expect(trigger.textContent).not.toContain('1') // no number in the badge anymore
  })

  test('toggling an item writes the new value through', () => {
    render(<OptionsMenu options={mainOptions()} ecoOptions={ecoOptions()} showEco={false} busy={false} />)
    open()
    fireEvent.click(screen.getByText('Autopilot'))
    expect(updatePreferences).toHaveBeenCalledWith({ autopilot: true })
  })

  test('hides the Eco sub-drops when Eco does not apply', () => {
    render(<OptionsMenu options={mainOptions()} ecoOptions={ecoOptions()} showEco={false} busy={false} />)
    open()
    expect(screen.queryByText('Auto planning')).toBeNull()
  })

  test('shows the Eco sub-drops when Eco applies', () => {
    render(<OptionsMenu options={mainOptions()} ecoOptions={ecoOptions()} showEco={true} busy={false} />)
    open()
    expect(screen.getByText('Auto planning')).toBeTruthy()
  })

  test('a disabled row is greyed out and says why, and cannot be toggled', () => {
    const options: OptionRow[] = [
      { key: 'browser', label: 'Browser', title: 't', description: 'Gives the agent a real browser.', checked: false, disabled: true, disabledReason: 'only on Claude Code' },
    ]
    render(<OptionsMenu options={options} ecoOptions={ecoOptions()} showEco={false} busy={false} />)
    open()
    expect(screen.getByText(/only on Claude Code/)).toBeTruthy()
    fireEvent.click(screen.getByText('Browser'))
    expect(updatePreferences).not.toHaveBeenCalled()
  })

  test('a disabled Eco sub-drop cannot be toggled either (#801)', () => {
    // The sub-rows rendered the reason but stayed clickable, so a gated one (Auto maintenance under
    // Post-merge cleanup) would have looked disabled and still written through.
    const eco: OptionRow[] = [
      { key: 'ecoMaintenance', label: 'Auto maintenance', title: 't', checked: false, disabled: true, disabledReason: 'only applies while Post-merge cleanup is on' },
    ]
    render(<OptionsMenu options={mainOptions()} ecoOptions={eco} showEco={true} busy={false} />)
    open()
    expect(screen.getByText(/only applies while Post-merge cleanup is on/)).toBeTruthy()
    fireEvent.click(screen.getByText('Auto maintenance'))
    expect(updatePreferences).not.toHaveBeenCalled()
  })

  test('the Run on submenu picks a target and calls back (#1050)', () => {
    const onChange = vi.fn()
    render(
      <OptionsMenu
        options={mainOptions()}
        ecoOptions={ecoOptions()}
        showEco={false}
        busy={false}
        runTarget={{ value: 'local', onChange }}
      />,
    )
    open()
    fireEvent.click(screen.getByText('Run on'))
    fireEvent.click(screen.getByText('GitHub Actions'))
    expect(onChange).toHaveBeenCalledWith('actions')
  })

  test('the Run on submenu is absent when no target control is passed (in-session) (#1050)', () => {
    render(<OptionsMenu options={[]} ecoOptions={[]} showEco={false} busy={false} />)
    open()
    expect(screen.queryByText('Run on')).toBeNull()
  })

})
