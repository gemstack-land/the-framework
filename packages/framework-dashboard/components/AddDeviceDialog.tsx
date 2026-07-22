import { useState, type KeyboardEvent } from 'react'
import { addProfile, parseDeviceUrl } from '../lib/profiles.js'
import { Button } from './ui/button.js'
import { Dialog } from './ui/dialog.js'

// The "Add a device" modal off the gear (#1052). A device is any reachable daemon — a LAN IP, a
// tailnet name, a tunnel URL — so the input is not a LAN-IP model but the full `?token=` URL the
// box prints on its non-loopback bind (cli.ts). We parse the origin and token out of one paste;
// the token is a per-browser secret, so it lands in localStorage (profiles.ts), never a server file.

export function AddDeviceDialog({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [url, setUrl] = useState('')
  const [label, setLabel] = useState('')
  const parsed = parseDeviceUrl(url)
  // A pasted URL with no `?token=` cannot authenticate against a guarded box, so it is not savable.
  const valid = parsed !== null && parsed.token !== ''

  const save = () => {
    if (!parsed || !valid) return
    addProfile({ url: parsed.url, token: parsed.token, ...(label.trim() ? { label } : {}) })
    onAdded()
    onClose()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      save()
    }
  }

  return (
    <Dialog open onOpenChange={next => { if (!next) onClose() }} title="Add a device">
      <div className="flex w-full flex-col gap-2" onKeyDown={onKeyDown}>
        <p className="text-xs text-muted-foreground">
          Paste the URL the box printed on its network bind (it looks like <code>http://host:port/?token=…</code>).
        </p>
        <input
          type="text"
          value={url}
          placeholder="http://host:port/?token=…"
          autoFocus
          onChange={e => setUrl(e.target.value)}
          className="w-full rounded-md border border-border bg-background px-2 py-1 font-mono text-xs text-foreground"
        />
        <input
          type="text"
          value={label}
          maxLength={60}
          placeholder={parsed ? `Name (optional) — defaults to ${new URL(parsed.url).host}` : 'Name (optional)'}
          onChange={e => setLabel(e.target.value)}
          className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
        />
        {url.trim() !== '' && !valid && (
          <p className="text-xs text-warning">
            {parsed === null ? 'That is not a valid URL.' : 'This URL has no token, so the box could not authenticate you.'}
          </p>
        )}
        <div className="mt-1 flex items-center justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" size="sm" disabled={!valid} onClick={save}>
            Add device
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
