import { useEffect } from 'react'
import { Laptop, MonitorSmartphone } from 'lucide-react'
import { useConnectionProfiles, currentConnection, rememberLocalOrigin } from '../lib/profiles.js'

// The "connected to <label>" indicator (#1052): which daemon the dashboard is talking to. Every
// transport is same-origin, so the browser's origin IS the connection — loopback is this machine's
// own daemon ("Local"), any other origin is a device you hopped to. It reads accented off Local so
// a remote box (where the agent runs on someone else's hardware) is never mistaken for your own.
export function ConnectionIndicator() {
  const profiles = useConnectionProfiles()
  // Remember the loopback origin we launched from, so "Local" can return to the right port later.
  useEffect(() => {
    if (typeof window !== 'undefined') rememberLocalOrigin(window.location.origin, window.location.hostname)
  }, [])
  if (typeof window === 'undefined') return null
  const { label, isLocal } = currentConnection(profiles, window.location.origin, window.location.hostname)
  const Icon = isLocal ? Laptop : MonitorSmartphone
  return (
    <span
      title={isLocal ? 'Connected to this machine' : `Connected to ${label} — the agent runs on that device`}
      className={
        isLocal
          ? 'hidden items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground sm:inline-flex'
          : 'inline-flex items-center gap-1.5 rounded-md border border-[var(--color-primary)]/40 bg-[var(--color-primary)]/10 px-2 py-1 text-xs text-[var(--color-primary)]'
      }
    >
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span className="max-w-[10rem] truncate">{label}</span>
    </span>
  )
}
