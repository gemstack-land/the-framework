import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { Preferences } from '@gemstack/the-framework'
import type { NotifyChannels } from '../server/preferences.telefunc.js'

// The Discord setup dialogs (#1095). What is worth pinning is the credential contract, not the
// copy: a credential goes in and never comes back, an env-set one is reported rather than edited,
// and what is stored is offered as Replace/Remove rather than a field with a secret in it.

// Typed as the RPC's own result union, not inferred from the happy-path default, so a test can
// set the refusal case.
const saveDiscordCredentials = vi.hoisted(() =>
  vi.fn<(patch: unknown) => Promise<{ ok: true } | { ok: false; error: string }>>(async () => ({ ok: true })),
)
vi.mock('../server/preferences.telefunc.js', () => ({ saveDiscordCredentials }))

const updatePreferences = vi.hoisted(() => vi.fn())
let prefs: Preferences = {}
vi.mock('../lib/preferences.js', () => ({
  usePreferences: () => prefs,
  updatePreferences,
  discordEnabled: (p: Preferences) => p.notifyDiscord ?? false,
  discordBotEnabled: (p: Preferences) => p.discordBot ?? false,
}))

const { DiscordBotDialog, DiscordWebhookDialog } = await import('./DiscordDialogs.js')

/** A channels payload: nothing configured unless a test says otherwise, and storable. */
const channels = (sources: NotifyChannels['sources'] = {}, editable = true): NotifyChannels => ({
  discordWebhook: sources.webhook !== undefined,
  discordBot: sources.botToken !== undefined,
  sources,
  editable,
})

const onSaved = vi.fn()

beforeEach(() => {
  prefs = {}
  saveDiscordCredentials.mockReset()
  saveDiscordCredentials.mockResolvedValue({ ok: true })
  updatePreferences.mockReset()
  onSaved.mockReset()
})
afterEach(cleanup)

const field = (label: RegExp) => screen.getByLabelText(label) as HTMLInputElement

describe('DiscordBotDialog (#1095)', () => {
  test('an unconfigured bot offers the setup steps and a token field', () => {
    render(<DiscordBotDialog open onOpenChange={() => {}} channels={channels()} onSaved={onSaved} />)

    expect(screen.getByText('Not configured yet')).toBeTruthy()
    // A credential is never a value the browser should keep in the clear.
    expect(field(/bot token/i).type).toBe('password')
  })

  test('saving a token sends it to the daemon and reloads the channel state', async () => {
    render(<DiscordBotDialog open onOpenChange={() => {}} channels={channels()} onSaved={onSaved} />)

    fireEvent.change(field(/bot token/i), { target: { value: 'a-plausible-bot-token-value' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(saveDiscordCredentials).toHaveBeenCalledWith({ botToken: 'a-plausible-bot-token-value' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    // Cleared after the save: the field must not sit there holding the secret.
    expect(field(/bot token/i).value).toBe('')
  })

  test('a malformed token is refused before the round trip', () => {
    render(<DiscordBotDialog open onOpenChange={() => {}} channels={channels()} onSaved={onSaved} />)

    fireEvent.change(field(/bot token/i), { target: { value: 'short' } })
    expect(screen.getByText(/too short to be a bot token/i)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true)
    expect(saveDiscordCredentials).not.toHaveBeenCalled()
  })

  test('a stored token shows as saved, with no field until you ask to replace it', () => {
    render(
      <DiscordBotDialog open onOpenChange={() => {}} channels={channels({ botToken: 'stored' })} onSaved={onSaved} />,
    )

    expect(screen.getByText('Bot token saved')).toBeTruthy()
    expect(screen.queryByLabelText(/bot token/i)).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Replace' }))
    expect(field(/bot token/i).value).toBe('')
  })

  test('Remove clears the stored credential', async () => {
    render(
      <DiscordBotDialog open onOpenChange={() => {}} channels={channels({ botToken: 'stored' })} onSaved={onSaved} />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(saveDiscordCredentials).toHaveBeenCalledWith({ botToken: null }))
  })

  test('a token set in the daemon environment is reported, not editable', () => {
    render(<DiscordBotDialog open onOpenChange={() => {}} channels={channels({ botToken: 'env' })} onSaved={onSaved} />)

    expect(screen.getByText('DISCORD_BOT_TOKEN')).toBeTruthy()
    expect(screen.queryByLabelText(/bot token/i)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Replace' })).toBeNull()
  })

  test('a host that stores no credentials says so instead of offering a field', () => {
    render(<DiscordBotDialog open onOpenChange={() => {}} channels={channels({}, false)} onSaved={onSaved} />)

    expect(screen.getByText(/does not store credentials/i)).toBeTruthy()
    expect(screen.queryByLabelText(/bot token/i)).toBeNull()
  })

  test('a failed save is reported and nothing is claimed to have landed', async () => {
    saveDiscordCredentials.mockResolvedValue({ ok: false, error: 'DISCORD_BOT_TOKEN is set on the daemon, so this is not editable here.' })
    render(<DiscordBotDialog open onOpenChange={() => {}} channels={channels()} onSaved={onSaved} />)

    fireEvent.change(field(/bot token/i), { target: { value: 'a-plausible-bot-token-value' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(screen.getByText(/is set on the daemon/i)).toBeTruthy())
    expect(onSaved).not.toHaveBeenCalled()
  })

  test('the preference toggle still writes through, credential or not', () => {
    render(<DiscordBotDialog open onOpenChange={() => {}} channels={channels()} onSaved={onSaved} />)

    fireEvent.click(screen.getByRole('button', { name: 'Enable' }))
    expect(updatePreferences).toHaveBeenCalledWith({ discordBot: true })
  })
})

describe('DiscordWebhookDialog (#1095)', () => {
  test('saving a webhook URL sends it under its own key, leaving the bot token alone', async () => {
    render(<DiscordWebhookDialog open onOpenChange={() => {}} channels={channels()} onSaved={onSaved} />)

    fireEvent.change(field(/webhook url/i), { target: { value: 'https://discord.com/api/webhooks/1/abc' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(saveDiscordCredentials).toHaveBeenCalledWith({ webhook: 'https://discord.com/api/webhooks/1/abc' }),
    )
  })

  test('a URL that is not one is refused before the round trip', () => {
    render(<DiscordWebhookDialog open onOpenChange={() => {}} channels={channels()} onSaved={onSaved} />)

    fireEvent.change(field(/webhook url/i), { target: { value: 'not a url' } })
    expect(screen.getByText(/not a URL/i)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true)
  })

  test('its toggle is Discord delivery, not the bot', () => {
    render(<DiscordWebhookDialog open onOpenChange={() => {}} channels={channels()} onSaved={onSaved} />)

    fireEvent.click(screen.getByRole('button', { name: 'Enable' }))
    expect(updatePreferences).toHaveBeenCalledWith({ notifyDiscord: true })
  })
})
