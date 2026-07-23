import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { useConnectionProfiles, removeProfile, type ConnectionProfile } from '../lib/profiles.js'
import { useDeviceStatus } from '../lib/use-device-status.js'
import { useSelectedRemoteDeviceId, selectRemoteDevice } from '../lib/remote-target.js'
import { AddDeviceDialog } from './AddDeviceDialog.js'
import { Button } from './ui/button.js'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card.js'
import { cn } from '../lib/utils.js'

// Saved devices, as a settings section (#1052/#1072).
//
// Adding and removing a device already worked, but only from the composer's "Run on" menu, and the
// composer exists on a project launcher and nowhere else: from the Overview or the settings page
// there was no way to manage the roster at all. The picker keeps listing devices, because choosing
// a run target is a per-run act; which devices exist is configuration, so it belongs here.
//
// Unlike everything else on the settings page these are NOT preferences. A device carries a token,
// so it lives in this browser's localStorage and never reaches the daemon (see profiles.ts). The
// section says so, because the reasonable assumption for a settings row is that it follows you to
// the next browser, and this one does not.

export function DevicesSettings() {
  const profiles = useConnectionProfiles()
  const status = useDeviceStatus(profiles)
  const selectedDeviceId = useSelectedRemoteDeviceId()
  const [adding, setAdding] = useState(false)

  // The same guard the composer applies (#1072): a device that is removed must not stay the run
  // target, or the next run points at something that is no longer in the list.
  const remove = (profile: ConnectionProfile) => {
    if (selectedDeviceId === profile.id) selectRemoteDevice(null)
    removeProfile(profile.id)
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle>Devices</CardTitle>
          <p className="text-sm text-muted-foreground">
            Other machines running The Framework that you can run a session on. Saved in this browser, not on the
            server, because each one is reached with its own token.
          </p>
        </div>
        <Button size="sm" variant="outline" className="shrink-0 whitespace-nowrap" onClick={() => setAdding(true)}>
          Add device
        </Button>
      </CardHeader>
      <CardContent>
        {profiles.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">
            No devices saved. Add one with the URL another machine prints when it starts.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {profiles.map(profile => (
              <li key={profile.id} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <p className="truncate text-sm">{profile.label}</p>
                  <p className="truncate text-xs text-muted-foreground">{profile.url}</p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <DeviceStatusBadge state={status[profile.id]} />
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => remove(profile)}
                    title={`Remove ${profile.label}`}
                    aria-label={`Remove ${profile.label}`}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      {adding && <AddDeviceDialog onClose={() => setAdding(false)} onAdded={() => setAdding(false)} />}
    </Card>
  )
}

/** Online / offline, or neither while the first ping is still out. */
function DeviceStatusBadge({ state }: { state: 'online' | 'offline' | undefined }) {
  const label = state === 'online' ? 'Online' : state === 'offline' ? 'Offline' : 'Checking…'
  return (
    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <span
        aria-hidden
        className={cn(
          'h-1.5 w-1.5 rounded-full',
          state === 'online' ? 'bg-[var(--color-primary)]' : 'bg-muted-foreground/40',
        )}
      />
      {label}
    </span>
  )
}
