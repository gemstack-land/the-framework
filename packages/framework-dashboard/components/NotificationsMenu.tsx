import { useSyncExternalStore } from 'react'
import { Bell, BellOff } from 'lucide-react'
import { usePreferences, updatePreferences, notificationsEnabled, discordEnabled, discordBotEnabled, newActivityEnabled, humanInterventionEnabled } from '../lib/preferences.js'
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

/** Subscribe to `Notification.permission` changes where the browser supports it, else 'unsupported'. */
function usePermission(): NotificationPermission | 'unsupported' {
  return useSyncExternalStore(
    subscribePermission,
    () => (typeof Notification === 'undefined' ? 'unsupported' : Notification.permission),
    () => 'unsupported',
  )
}

function subscribePermission(onChange: () => void): () => void {
  // No permission-change event fires on every browser; the value also changes right after our own
  // requestPermission() resolves (which re-renders anyway). Poll lightly as a backstop.
  const timer = setInterval(onChange, 3000)
  return () => clearInterval(timer)
}

export function NotificationsMenu() {
  const preferences = usePreferences()
  const browser = notificationsEnabled(preferences)
  const discord = discordEnabled(preferences)
  const activity = newActivityEnabled(preferences)
  const needsYou = humanInterventionEnabled(preferences)
  const discordBot = discordBotEnabled(preferences)
  const permission = usePermission()
  const browserSupported = permission !== 'unsupported'
  const blocked = permission === 'denied'
  // Browser only actually fires once the browser has granted permission; Discord is delivered
  // daemon-side, so it counts as active whenever it's on. "Active" drives the bell + dot.
  const browserActive = browser && permission === 'granted'
  const anyActive = browserActive || discord

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
            title="Reaches you with no dashboard open (needs DISCORD_WEBHOOK on the daemon)"
            className="items-start"
          >
            <OptionLabel label="Discord" description="Needs DISCORD_WEBHOOK on the daemon" />
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
            title="Lets Discord messages start and steer sessions (needs DISCORD_BOT_TOKEN on the daemon)"
            className="items-start"
          >
            <OptionLabel label="Discord bot" description="Start and steer sessions from Discord" />
          </DropdownMenuCheckboxItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
