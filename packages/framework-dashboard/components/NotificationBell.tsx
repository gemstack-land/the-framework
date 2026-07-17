import { useSyncExternalStore } from 'react'
import { Bell, BellOff } from 'lucide-react'
import { usePreferences, updatePreferences, notificationsEnabled } from '../lib/preferences.js'
import { cn } from '../lib/utils.js'

// The notifications toggle in the shell header (#627). One click controls the whole "needs you"
// notification path: it flips the preference and, when turning on for the first time, asks the
// browser for permission (which must come from this user gesture). The icon reflects the real
// state — on, off, or blocked at the browser level — so it never claims to notify when it can't.

/** Subscribe to `Notification.permission` changes where the browser supports it, else 'unsupported'. */
function usePermission(): NotificationPermission | 'unsupported' {
  return useSyncExternalStore(
    subscribePermission,
    () => (typeof Notification === 'undefined' ? 'unsupported' : Notification.permission),
    () => 'unsupported',
  )
}

function subscribePermission(onChange: () => void): () => void {
  // There is no permission-change event on all browsers; the value also changes right after our
  // own requestPermission() resolves, which re-renders anyway. Poll lightly as a backstop.
  const timer = setInterval(onChange, 3000)
  return () => clearInterval(timer)
}

export function NotificationBell() {
  const preferences = usePreferences()
  const enabled = notificationsEnabled(preferences)
  const permission = usePermission()
  if (permission === 'unsupported') return null

  const blocked = permission === 'denied'
  const active = enabled && permission === 'granted'
  const title = blocked
    ? 'Notifications are blocked in your browser settings'
    : !enabled
      ? 'Notifications off — click to turn on'
      : permission === 'default'
        ? 'Click to allow browser notifications'
        : 'Notifications on — click to mute'

  const onClick = () => {
    const next = !enabled
    updatePreferences({ notifyBrowser: next })
    if (next && permission === 'default') void Notification.requestPermission()
  }

  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className={cn(
        'rounded-md p-1.5 hover:bg-accent',
        active ? 'text-foreground' : 'text-muted-foreground',
        blocked && 'opacity-50',
      )}
    >
      {active ? <Bell className="h-4 w-4" /> : <BellOff className="h-4 w-4" />}
    </button>
  )
}
