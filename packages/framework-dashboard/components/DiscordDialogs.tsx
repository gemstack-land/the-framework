import { useEffect, useState } from 'react'
import { credentialEnvVar, validateCredential } from '@gemstack/the-framework/client'
import { saveDiscordCredentials, type NotifyChannels } from '../server/preferences.telefunc.js'
import { Dialog } from './ui/dialog.js'
import { Button } from './ui/button.js'
import { usePreferences, updatePreferences, discordBotEnabled, discordEnabled } from '../lib/preferences.js'

// The two Discord setup dialogs (#958, credentials in #1095).
//
// #958 shipped these as explainers: they described what to set and told you to edit the daemon's
// environment and restart it, which is what made Discord the one onboarding step you could not
// finish in the product. They now take the credential.
//
// The value goes straight to the daemon and is never read back — the dialog is told only that one
// is stored, and where it came from — which is why a configured credential offers Replace and
// Remove rather than a pre-filled field. A credential set in the daemon's environment wins over a
// stored one, so that case is reported as fixed instead of offering an edit the daemon would shadow.
//
// The descriptions are exported because each is shown twice on purpose: once on the Onboarding
// checklist row, and again inside the dialog, which is also reachable without the checklist.

/** What the Discord bot is, in one line. Shown on the checklist row and again inside the dialog. */
export const DISCORD_BOT_DESCRIPTION =
  'Brings sessions into Discord: it posts what each session is doing, and lets you start and steer sessions by replying — so you can follow work with no dashboard open.'

/** What the Discord webhook is, in one line. Same two homes as the bot description above. */
export const DISCORD_WEBHOOK_DESCRIPTION =
  'Delivers notifications to Discord, so a session waiting on you reaches you with no dashboard open.'

/** What both dialogs take from their host: what the daemon holds, and a reload for after a save. */
interface DialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** What the daemon holds, from `onNotifyChannels`. Null while the first read is in flight. */
  channels: NotifyChannels | null
  /** Re-read the channels, so the dialog and its host agree the moment a save lands. */
  onSaved: () => void
}

/** The Discord bot's explainer and setup dialog (#958/#1095). */
export function DiscordBotDialog(props: DialogProps) {
  const enabled = discordBotEnabled(usePreferences())
  return (
    <CredentialDialog
      {...props}
      credential="botToken"
      title="Discord bot"
      description={DISCORD_BOT_DESCRIPTION}
      label="Bot token"
      placeholder="Paste the bot token"
      steps={[
        'Create a Discord application with a bot, and invite it to your server.',
        'Copy the bot token from its Bot tab.',
        'Paste it below.',
      ]}
      toggle={{
        on: enabled,
        onLabel: 'Bot enabled',
        offLabel: 'Bot disabled',
        description: 'Whether Discord messages may start and steer sessions.',
        set: next => updatePreferences({ discordBot: next }),
      }}
    />
  )
}

/** The Discord notifications explainer and setup dialog (#1095), the webhook twin of the bot one. */
export function DiscordWebhookDialog(props: DialogProps) {
  const on = discordEnabled(usePreferences())
  return (
    <CredentialDialog
      {...props}
      credential="webhook"
      title="Discord notifications"
      description={DISCORD_WEBHOOK_DESCRIPTION}
      label="Webhook URL"
      placeholder="https://discord.com/api/webhooks/…"
      steps={[
        'In Discord, open the channel the notifications should land in.',
        'Edit Channel → Integrations → Webhooks → New Webhook, then Copy Webhook URL.',
        'Paste it below.',
      ]}
      toggle={{
        on,
        onLabel: 'Discord delivery on',
        offLabel: 'Discord delivery off',
        description: 'Whether notifications are posted to Discord.',
        set: next => updatePreferences({ notifyDiscord: next }),
      }}
    />
  )
}

/** The preference toggle each dialog carries below its credential field. */
interface ToggleSpec {
  on: boolean
  onLabel: string
  offLabel: string
  description: string
  set: (next: boolean) => void
}

/**
 * The shell both dialogs are: explain, take the credential, toggle the preference. One component
 * rather than two near-copies, because what differs between them is a credential name and its
 * words — while everything that could drift (what "configured" means, what an env-set credential
 * does to the form, how a save is reported) is behaviour they have to share.
 */
function CredentialDialog({
  open,
  onOpenChange,
  channels,
  onSaved,
  credential,
  title,
  description,
  label,
  placeholder,
  steps,
  toggle,
}: DialogProps & {
  credential: 'botToken' | 'webhook'
  title: string
  description: string
  label: string
  placeholder: string
  steps: string[]
  toggle: ToggleSpec
}) {
  const source = channels?.sources[credential]
  const configured = source !== undefined
  // An env-set credential is the daemon's, not ours: reported, not edited.
  const fromEnv = source === 'env'
  const storable = channels?.editable ?? false

  const [value, setValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // A stored credential shows as stored, with the field behind Replace — so the settled case is
  // not a text box inviting you to retype a secret you cannot see.
  const [replacing, setReplacing] = useState(false)

  // Never leave a typed credential behind when the dialog closes: reopening it must not hand the
  // next person at the keyboard a token sitting in a field.
  useEffect(() => {
    if (open) return
    setValue('')
    setError(null)
    setReplacing(false)
  }, [open])

  const showField = storable && !fromEnv && (!configured || replacing)
  const invalid = value.trim() ? validateCredential(credential, value) : undefined

  const save = async (next: string | null) => {
    setSaving(true)
    setError(null)
    // Written out rather than a computed key: a `{ [credential]: next }` widens to an index
    // signature, and the patch's whole point is that an unmentioned credential is left alone.
    const patch = credential === 'botToken' ? { botToken: next } : { webhook: next }
    const result = await saveDiscordCredentials(patch).catch(() => ({
      ok: false as const,
      error: 'Could not reach the daemon.',
    }))
    setSaving(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setValue('')
    setReplacing(false)
    onSaved()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={title}>
      <div className="flex flex-col gap-3 text-sm">
        <p className="text-muted-foreground">{description}</p>

        {fromEnv ? (
          <p className="text-muted-foreground">
            Set by <code className="rounded bg-muted px-1 py-0.5 text-xs">{credentialEnvVar(credential)}</code> in the
            daemon&apos;s environment, so it is not editable here. Unset it and restart the daemon to manage it from
            the dashboard instead.
          </p>
        ) : !storable ? (
          <p className="text-muted-foreground">
            This server does not store credentials, so Discord cannot be set up from here.
          </p>
        ) : configured && !replacing ? (
          <div className="flex items-center justify-between gap-3 rounded-md border border-border p-3">
            <span className="flex flex-col gap-0.5">
              <span>{label} saved</span>
              <span className="text-xs text-muted-foreground">Held on the daemon, and never shown again.</span>
            </span>
            <span className="flex shrink-0 gap-2">
              <Button variant="outline" size="sm" onClick={() => setReplacing(true)}>
                Replace
              </Button>
              <Button variant="ghost" size="sm" disabled={saving} onClick={() => void save(null)}>
                Remove
              </Button>
            </span>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="font-medium">Not configured yet</p>
            <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
              {steps.map(step => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </div>
        )}

        {showField && (
          <div className="flex flex-col gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">{label}</span>
              <input
                type="password"
                value={value}
                placeholder={placeholder}
                autoFocus
                autoComplete="off"
                spellCheck={false}
                onChange={e => setValue(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-2 py-1 font-mono text-xs text-foreground"
              />
            </label>
            {invalid && <p className="text-xs text-warning">{invalid}</p>}
            <div className="flex items-center justify-end gap-2">
              {replacing && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setReplacing(false)
                    setValue('')
                  }}
                >
                  Cancel
                </Button>
              )}
              <Button size="sm" disabled={!value.trim() || Boolean(invalid) || saving} onClick={() => void save(value)}>
                {saving ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </div>
        )}

        {error && <p className="text-xs text-destructive">{error}</p>}

        <div className="flex items-center justify-between gap-3 rounded-md border border-border p-3">
          <span className="flex flex-col gap-0.5">
            <span>{toggle.on ? toggle.onLabel : toggle.offLabel}</span>
            <span className="text-xs text-muted-foreground">
              {configured ? toggle.description : 'Can be turned on now; it starts working once the credential is set.'}
            </span>
          </span>
          <Button variant={toggle.on ? 'outline' : 'default'} size="sm" onClick={() => toggle.set(!toggle.on)}>
            {toggle.on ? 'Disable' : 'Enable'}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
