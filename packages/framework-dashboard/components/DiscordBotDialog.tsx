import { Dialog } from './ui/dialog.js'
import { Button } from './ui/button.js'
import { usePreferences, updatePreferences, discordBotEnabled } from '../lib/preferences.js'

// The Discord bot's explainer and setup dialog (#958).
//
// The description is exported because it is shown twice on purpose: once on the Onboarding
// checklist row, and again here — the dialog is also reachable without the checklist, and a
// modal that only says "enable this" explains nothing to whoever opens it that way.
//
// The token itself stays a daemon environment variable. This dialog explains and toggles; it
// deliberately does not take a token, which would mean the dashboard storing a secret.

/** What the Discord bot is, in one line. Shown on the checklist row and again inside the dialog. */
export const DISCORD_BOT_DESCRIPTION =
  'Brings sessions into Discord: it posts what each session is doing, and lets you start and steer sessions by replying — so you can follow work with no dashboard open.'

export function DiscordBotDialog({
  open,
  onOpenChange,
  configured,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Whether the daemon actually has a bot token. The toggle is a preference; this is the capability. */
  configured: boolean
}) {
  const enabled = discordBotEnabled(usePreferences())

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Discord bot">
      <div className="flex flex-col gap-3 text-sm">
        <p className="text-muted-foreground">{DISCORD_BOT_DESCRIPTION}</p>

        {configured ? (
          <p className="text-muted-foreground">
            The daemon has a bot token, so the bot can run. Use the toggle below to turn it on or off.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="font-medium">Not configured yet</p>
            <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
              <li>Create a Discord application with a bot, and invite it to your server.</li>
              <li>
                Set <code className="rounded bg-muted px-1 py-0.5 text-xs">DISCORD_BOT_TOKEN</code> in the
                environment the daemon runs in.
              </li>
              <li>Restart the daemon so it reads the token.</li>
            </ol>
          </div>
        )}

        <div className="flex items-center justify-between gap-3 rounded-md border border-border p-3">
          <span className="flex flex-col gap-0.5">
            <span>{enabled ? 'Bot enabled' : 'Bot disabled'}</span>
            <span className="text-xs text-muted-foreground">
              {configured
                ? 'Whether Discord messages may start and steer sessions.'
                : 'Can be turned on now; it starts working once the token is set.'}
            </span>
          </span>
          <Button variant={enabled ? 'outline' : 'default'} size="sm" onClick={() => updatePreferences({ discordBot: !enabled })}>
            {enabled ? 'Disable' : 'Enable'}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
