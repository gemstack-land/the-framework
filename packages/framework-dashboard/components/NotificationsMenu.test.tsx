import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { Preferences } from '@gemstack/framework'

const updatePreferences = vi.hoisted(() => vi.fn())
let prefs: Preferences = {}
vi.mock('../lib/preferences.js', () => ({
  usePreferences: () => prefs,
  updatePreferences,
  notificationsEnabled: (p: Preferences) => p.notifyBrowser ?? true,
  discordEnabled: (p: Preferences) => p.notifyDiscord ?? false,
  discordBotEnabled: (p: Preferences) => p.discordBot ?? false,
  newActivityEnabled: (p: Preferences) => p.notifyNewActivity ?? false,
  humanInterventionEnabled: (p: Preferences) => p.notifyHumanIntervention ?? true,
}))

const { NotificationsMenu } = await import('./NotificationsMenu.js')

beforeEach(() => {
  prefs = {}
  updatePreferences.mockReset()
  vi.stubGlobal('Notification', { permission: 'granted', requestPermission: vi.fn() })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const open = () => fireEvent.click(screen.getByRole('button', { name: /notifications/i }))

describe('NotificationsMenu (#676)', () => {
  test('the popover groups methods and categories, both "Needs you" and "New activity" toggleable', () => {
    render(<NotificationsMenu />)
    open()
    expect(screen.getByText('Deliver to')).toBeTruthy()
    expect(screen.getByText('Browser')).toBeTruthy()
    expect(screen.getByText('Discord')).toBeTruthy()
    expect(screen.getByText('Notify me about')).toBeTruthy()
    expect(screen.getByText('Needs you')).toBeTruthy()
    expect(screen.queryByText('Always on')).toBeNull() // #627: now a real toggle, no static row
    expect(screen.getByText('New activity')).toBeTruthy()
  })

  test('toggling Discord, New activity, and Needs you writes each preference through', () => {
    render(<NotificationsMenu />)
    open()
    fireEvent.click(screen.getByText('Discord'))
    expect(updatePreferences).toHaveBeenCalledWith({ notifyDiscord: true })
    fireEvent.click(screen.getByText('New activity'))
    expect(updatePreferences).toHaveBeenCalledWith({ notifyNewActivity: true })
    // Defaults on, so the click turns it OFF (#627).
    fireEvent.click(screen.getByText('Needs you'))
    expect(updatePreferences).toHaveBeenCalledWith({ notifyHumanIntervention: false })
  })

  test('enabling Browser asks for permission when it has not been granted yet', () => {
    prefs = { notifyBrowser: false }
    vi.stubGlobal('Notification', { permission: 'default', requestPermission: vi.fn() })
    render(<NotificationsMenu />)
    open()
    fireEvent.click(screen.getByText('Browser'))
    expect(updatePreferences).toHaveBeenCalledWith({ notifyBrowser: true })
    expect((globalThis.Notification as unknown as { requestPermission: () => void }).requestPermission).toHaveBeenCalled()
  })

  test('the bell reads active when a granted method is on, idle otherwise', () => {
    const { rerender } = render(<NotificationsMenu />) // default: browser on + granted
    expect(screen.getByRole('button', { name: /notifications/i }).getAttribute('title')).toBe('Notifications on')
    prefs = { notifyBrowser: false } // no method effectively on
    rerender(<NotificationsMenu />)
    expect(screen.getByRole('button', { name: /notifications/i }).getAttribute('title')).toBe('Notifications')
  })

  test('a blocked browser permission disables the Browser toggle with a hint', () => {
    vi.stubGlobal('Notification', { permission: 'denied', requestPermission: vi.fn() })
    render(<NotificationsMenu />)
    open()
    expect(screen.getByText('Blocked in your browser settings')).toBeTruthy()
  })

  test('the Discord bot is its own group, not a delivery method (#916)', () => {
    render(<NotificationsMenu />)
    open()
    // Everything under "Deliver to" posts outward; the bot takes messages in and acts on them,
    // so it is grouped apart rather than sitting next to the Discord notification toggle.
    expect(screen.getByText('Chat')).toBeTruthy()
    expect(screen.getByText('Discord bot')).toBeTruthy()
  })

  test('the Discord bot toggle is off by default and writes the preference (#916)', () => {
    render(<NotificationsMenu />)
    open()
    const item = screen.getByText('Discord bot').closest('[role="menuitemcheckbox"]')
    expect(item?.getAttribute('aria-checked')).toBe('false')

    fireEvent.click(screen.getByText('Discord bot'))
    expect(updatePreferences).toHaveBeenCalledWith({ discordBot: true })
  })

  test('turning the bot on does not light the bell, which is about notifications (#916)', () => {
    prefs = { discordBot: true, notifyBrowser: false, notifyDiscord: false }
    render(<NotificationsMenu />)
    expect(screen.getByRole('button', { name: /notifications/i }).getAttribute('title')).toBe('Notifications')
  })
})
