import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import type { NotifyChannels } from '../server/preferences.telefunc.js'

// The shared channel state (#1095). The bug it exists for: three components showed the same fact
// from three independent polls, so saving a credential in one settled that one and left the others
// claiming "not configured" until their own timers came round.

const onNotifyChannels = vi.hoisted(() => vi.fn())
vi.mock('../server/preferences.telefunc.js', () => ({ onNotifyChannels }))

const { useNotifyChannels, reloadNotifyChannels } = await import('./notify-channels.js')

const configured: NotifyChannels = { discordWebhook: true, discordBot: true, sources: { webhook: 'stored', botToken: 'stored' }, editable: true }
const empty: NotifyChannels = { discordWebhook: false, discordBot: false, sources: {}, editable: true }

/** Two independent readers, the way the settings page and the checklist sit on one screen. */
function Reader({ name }: { name: string }) {
  const channels = useNotifyChannels()
  return <span data-testid={name}>{channels === null ? 'loading' : channels.discordWebhook ? 'configured' : 'none'}</span>
}

// The cache is module state and outlives a test, exactly as it outlives a component. Each test
// therefore sets the fact it wants and reloads, rather than assuming an unread store.
beforeEach(() => {
  onNotifyChannels.mockReset()
  onNotifyChannels.mockResolvedValue(empty)
})
afterEach(cleanup)

describe('the shared notify-channels store (#1095)', () => {
  test('several readers mounting together do not each ask the daemon', async () => {
    let settle: (value: NotifyChannels) => void = () => {}
    onNotifyChannels.mockReturnValue(new Promise<NotifyChannels>(resolve => (settle = resolve)))
    reloadNotifyChannels()
    onNotifyChannels.mockClear()

    render(
      <>
        <Reader name="a" />
        <Reader name="b" />
        <Reader name="c" />
      </>,
    )
    settle(empty)
    await waitFor(() => expect(screen.getByTestId('a').textContent).toBe('none'))

    // Every reader joined the read already in flight rather than starting its own.
    expect(onNotifyChannels).not.toHaveBeenCalled()
  })

  test('a reload settles every reader at once, which is the whole point (#1095)', async () => {
    onNotifyChannels.mockResolvedValue(empty)
    reloadNotifyChannels()
    render(
      <>
        <Reader name="a" />
        <Reader name="b" />
      </>,
    )
    await waitFor(() => expect(screen.getByTestId('a').textContent).toBe('none'))

    // A credential saved through one of the dialogs.
    onNotifyChannels.mockResolvedValue(configured)
    reloadNotifyChannels()

    await waitFor(() => {
      expect(screen.getByTestId('a').textContent).toBe('configured')
      expect(screen.getByTestId('b').textContent).toBe('configured')
    })
  })

  test('a failed read keeps the last known state rather than blanking it', async () => {
    onNotifyChannels.mockResolvedValue(configured)
    reloadNotifyChannels()
    render(<Reader name="a" />)
    await waitFor(() => expect(screen.getByTestId('a').textContent).toBe('configured'))

    onNotifyChannels.mockRejectedValue(new Error('daemon restarting'))
    reloadNotifyChannels()

    // A hiccup is not evidence the credential went away; flipping to "none" would be a lie.
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(screen.getByTestId('a').textContent).toBe('configured')
  })
})
