import { useSyncExternalStore } from 'react'
import { Bell, BellOff } from 'lucide-react'
import { usePreferences, updatePreferences, notificationsEnabled, discordEnabled, newActivityEnabled } from '../lib/preferences.js'
import { cn } from '../lib/utils.js'
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
// the header control that writes them.

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

/** A toggle's label with a short one-line hint under it (mirrors OptionsMenu's OptionLabel). */
function NotifLabel({ label, hint }: { label: string; hint?: string | undefined }) {
  return (
    <span className="flex flex-col gap-0.5">
      <span className="leading-tight">{label}</span>
      {hint && <span className="text-xs font-normal text-[var(--color-muted-foreground)]">{hint}</span>}
    </span>
  )
}

export function NotificationsMenu() {
  const preferences = usePreferences()
  const browser = notificationsEnabled(preferences)
  const discord = discordEnabled(preferences)
  const activity = newActivityEnabled(preferences)
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
              <NotifLabel label="Browser" hint={browserHint} />
            </DropdownMenuCheckboxItem>
          )}
          <DropdownMenuCheckboxItem
            checked={discord}
            onCheckedChange={next => updatePreferences({ notifyDiscord: next })}
            title="Reaches you with no dashboard open (needs DISCORD_WEBHOOK on the daemon)"
            className="items-start"
          >
            <NotifLabel label="Discord" hint="Needs DISCORD_WEBHOOK on the daemon" />
          </DropdownMenuCheckboxItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>Notify me about</DropdownMenuLabel>
          {/* "Needs you" is always on — a run awaiting an answer or a PR ready to review. Shown as
              a static row so the baseline is visible, not a toggle. */}
          <div className="flex items-start justify-between gap-2 px-2 py-1.5 pl-8 text-sm">
            <span className="flex flex-col gap-0.5">
              <span className="leading-tight">Needs you</span>
              <span className="text-xs text-[var(--color-muted-foreground)]">A run awaiting you, or a PR to review</span>
            </span>
            <span className="shrink-0 text-xs text-[var(--color-muted-foreground)]">Always on</span>
          </div>
          <DropdownMenuCheckboxItem
            checked={activity}
            onCheckedChange={next => updatePreferences({ notifyNewActivity: next })}
            title="Also ping when a run starts or finishes, not just when something needs you"
            className="items-start"
          >
            <NotifLabel label="New activity" hint="A run started or finished" />
          </DropdownMenuCheckboxItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
