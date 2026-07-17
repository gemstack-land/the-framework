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
  fireEvent.click(screen.getByRole('button', { name: /Options/ }))
}

describe('OptionsMenu (#654)', () => {
  test('the trigger badges how many options are on', () => {
    render(<OptionsMenu options={mainOptions()} ecoOptions={ecoOptions()} showEco={false} busy={false} />)
    // Only Eco is checked -> the trigger reads "Options 1".
    expect(screen.getByRole('button', { name: /Options/ }).textContent).toContain('1')
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
})
