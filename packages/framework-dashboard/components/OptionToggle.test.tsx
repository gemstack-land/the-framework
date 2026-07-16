import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

const updatePreferences = vi.hoisted(() => vi.fn())
vi.mock('../lib/preferences.js', () => ({ updatePreferences }))

const { OptionToggle } = await import('./OptionToggle.js')

afterEach(() => {
  cleanup()
  updatePreferences.mockReset()
})

describe('OptionToggle', () => {
  test('reflects checked and writes the toggled value through on change', () => {
    render(<OptionToggle option={{ key: 'autopilot', label: 'Autopilot', title: 't', checked: true }} busy={false} />)
    const box = screen.getByRole('checkbox') as HTMLInputElement
    expect(box.checked).toBe(true)
    expect(box.disabled).toBe(false)

    fireEvent.click(box)
    expect(updatePreferences).toHaveBeenCalledWith({ autopilot: false })
  })

  test('is disabled when busy, or when the row itself is disabled', () => {
    const { rerender } = render(<OptionToggle option={{ key: 'eco', label: 'Eco', title: 't', checked: false }} busy={true} />)
    expect((screen.getByRole('checkbox') as HTMLInputElement).disabled).toBe(true)

    rerender(<OptionToggle option={{ key: 'eco', label: 'Eco', title: 't', checked: false, disabled: true }} busy={false} />)
    expect((screen.getByRole('checkbox') as HTMLInputElement).disabled).toBe(true)
  })
})
