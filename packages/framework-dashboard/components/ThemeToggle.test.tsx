import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

const updatePreferences = vi.hoisted(() => vi.fn())
const usePreferences = vi.hoisted(() => vi.fn())
// The whole module is mocked: importing it for real pulls telefunc (and a server transport) into
// a component test. `themePreference` is one line, so restating it costs less than that.
vi.mock('../lib/preferences.js', () => ({
  updatePreferences,
  usePreferences,
  themePreference: (p: { theme?: string }) => p.theme ?? 'system',
}))

const { ThemeToggle } = await import('./ThemeToggle.js')

afterEach(() => {
  cleanup()
  updatePreferences.mockReset()
})

const open = () => fireEvent.click(screen.getByRole('button', { name: /theme/i }))

// #754: the theme was only reachable from inside the per-session options gear, which is both the wrong
// home for an app-wide setting and absent on a navbar-only screen. These pin that it is reachable
// from the header and writes the one preference the rest of the app reads.
describe('ThemeToggle (#754)', () => {
  test('picking a theme persists it', () => {
    usePreferences.mockReturnValue({ theme: 'system' })
    render(<ThemeToggle />)
    open()
    fireEvent.click(screen.getByText('Dark'))
    expect(updatePreferences).toHaveBeenCalledWith({ theme: 'dark' })
  })

  test('the trigger shows the current theme, so the header says which is on', () => {
    usePreferences.mockReturnValue({ theme: 'dark' })
    render(<ThemeToggle />)
    expect(screen.getByRole('button', { name: /theme/i }).getAttribute('title')).toBe('Theme: Dark')
  })

  test('an unset preference reads as system, the default', () => {
    usePreferences.mockReturnValue({})
    render(<ThemeToggle />)
    expect(screen.getByRole('button', { name: /theme/i }).getAttribute('title')).toBe('Theme: System')
  })
})
