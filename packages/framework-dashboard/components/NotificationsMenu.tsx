import { Bell, BellOff } from 'lucide-react'
import { useNotificationPermission } from '../lib/notification-permission.js'
import { usePreferences, updatePreferences, notificationsEnabled, discordEnabled, discordBotEnabled, newActivityEnabled, humanInterventionEnabled } from '../lib/preferences.js'
import { onNotifyChannels, type NotifyChannels } from '../server/preferences.telefunc.js'
import { useLoaded } from '../lib/use-async.js'
import { cn } from '../lib/utils.js'
import { OptionLabel } from './OptionsMenu.js'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuCheckboxItem,
  DropdownMenuSeparator,
} from './ui/dropdown-menu.js'

// One "Notifications" bell in the shell header (#676), replacing the three loose icons (bell /
// Discord / activity). It makes the model legible: the bell and Discord are *delivery methods*
// (where a notification goes), "New activity" is a *category* on top of the always-on "needs you"
// pings. The trigger shows an active state + dot when a method is effectively on; the popover
// groups and labels every toggle. The underlying prefs and hooks are unchanged — this is purely
// the header control that writes them. The Discord *bot* (#680) sits in its own "Chat" group
// rather than under a delivery method: it is the one control here that takes messages in.

export function NotificationsMenu() {
  const preferences = usePreferences()
  const browser = notificationsEnabled(preferences)
  const discord = discordEnabled(preferences)
  const activity = newActivityEnabled(preferences)
  const needsYou = humanInterventionEnabled(preferences)
  const discordBot = discordBotEnabled(preferences)
  const permission = useNotificationPermission()
  const browserSupported = permission !== 'unsupported'
  const blocked = permission === 'denied'
  // Whether the daemon can actually deliver on Discord (#948): the toggle is a preference,
  // the env var is the capability. `null` until the one-shot read lands — treated as capable
  // so the bell does not flicker for a properly configured setup.
  const channels = useLoaded<NotifyChannels | null>(onNotifyChannels, null, [])
  const webhookReady = channels === null || channels.discordWebhook
  const botReady = channels === null || channels.discordBot
  // Browser only actually fires once the browser has granted permission; Discord counts once
  // it is both on and deliverable — a toggle without the daemon env var lit the bell for a
  // channel delivering nothing (#948). "Active" drives the bell + dot.
  const browserActive = browser && permission === 'granted'
  const anyActive = browserActive || (discord && webhookReady)

  const toggleBrowser = (next: boolean) => {
    updatePreferences({ notifyBrowser: next })
    // Asking for permission must ride this user gesture (turning it on).
    if (next && permission === 'default') void Notification.requestPermission()
  }

  const browserHint = blocked
    ? 'Blocked in your browser settings'
    : browser && permission === 'default'
      ? 'Click to allow browser notifications'
      : 'Desktop notifications while the dashboard is open'

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        type="button"
        title={anyActive ? 'Notifications on' : 'Notifications'}
        aria-label="Notifications"
        className={cn(
          'relative rounded-md p-1.5 hover:bg-accent',
          anyActive ? 'text-foreground' : 'text-muted-foreground',
        )}
      >
        {anyActive ? <Bell className="h-4 w-4" /> : <BellOff className="h-4 w-4" />}
        {anyActive && (
          <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-[var(--color-primary)]" />
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[16rem]">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Deliver to</DropdownMenuLabel>
          {browserSupported && (
            <DropdownMenuCheckboxItem
              checked={browser}
              disabled={blocked}
              onCheckedChange={toggleBrowser}
              title={browserHint}
              className="items-start"
            >
              <OptionLabel label="Browser" description={browserHint} />
            </DropdownMenuCheckboxItem>
          )}
          <DropdownMenuCheckboxItem
            checked={discord}
            onCheckedChange={next => updatePreferences({ notifyDiscord: next })}
            title={webhookReady ? 'Reaches you with no dashboard open' : 'Set DISCORD_WEBHOOK on the daemon, then restart it, to deliver here'}
            className="items-start"
          >
            <OptionLabel
              label="Discord"
              description={webhookReady ? 'Reaches you with no dashboard open' : 'Not configured — DISCORD_WEBHOOK is not set on the daemon'}
            />
          </DropdownMenuCheckboxItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>Notify me about</DropdownMenuLabel>
          {/* "Needs you" (#627): a run awaiting an answer or a PR ready to review. Defaults on — the
              baseline category — but now a real toggle, so it can be turned off like any other. */}
          <DropdownMenuCheckboxItem
            checked={needsYou}
            onCheckedChange={next => updatePreferences({ notifyHumanIntervention: next })}
            title="A session awaiting your answer, or a PR ready to review"
            className="items-start"
          >
            <OptionLabel label="Needs you" description="A session awaiting you, or a PR to review" />
          </DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem
            checked={activity}
            onCheckedChange={next => updatePreferences({ notifyNewActivity: next })}
            title="Also ping when a session starts or finishes, not just when something needs you"
            className="items-start"
          >
            <OptionLabel label="New activity" description="A session started or finished" />
          </DropdownMenuCheckboxItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          {/* Its own group, not a delivery method (#916): everything above posts outward, this
              takes messages back in and lets them start and steer sessions (#680). */}
          <DropdownMenuLabel>Chat</DropdownMenuLabel>
          <DropdownMenuCheckboxItem
            checked={discordBot}
            onCheckedChange={next => updatePreferences({ discordBot: next })}
            title={botReady ? 'Lets Discord messages start and steer sessions' : 'Set DISCORD_BOT_TOKEN on the daemon, then restart it, to enable the bot'}
            className="items-start"
          >
            <OptionLabel
              label="Discord bot"
              description={botReady ? 'Start and steer sessions from Discord' : 'Not configured — DISCORD_BOT_TOKEN is not set on the daemon'}
            />
          </DropdownMenuCheckboxItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
