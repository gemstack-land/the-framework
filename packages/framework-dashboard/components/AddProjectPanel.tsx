import { useState, type FormEvent } from 'react'
import { sendAddProject } from '../server/projects.telefunc.js'
import { useAction } from '../lib/use-action.js'
import { Button } from './ui/button.js'

// Add project(s) (#396/#433): install a single repo, or every git repo directly under a
// directory, and register each so it joins the list. The daemon does the work; this posts
// the path over the `sendAddProject` telefunction and reloads on success.
//
// Lifted out of the projects sidebar when #772 replaced that rail with a navbar dropdown:
// the picker has no room for a two-step form, so it opens this as a small modal instead.
export function AddProjectPanel({ onAdded, onClose }: { onAdded: () => void; onClose: () => void }) {
  const [path, setPath] = useState('')
  const [directory, setDirectory] = useState(false)
  const { busy, error, reset, run } = useAction()
  // Trust gate (#439/#314): adding a repo lets the agent read its files, so an untrusted
  // repo is a prompt-injection risk. Confirm trust before actually installing.
  const [confirming, setConfirming] = useState(false)

  // Step 1: the user submits the path -> show the trust confirmation, don't add yet.
  const review = (e: FormEvent) => {
    e.preventDefault()
    if (!path.trim() || busy) return
    reset()
    setConfirming(true)
  }

  // Step 2: trust confirmed -> install + register.
  const confirmAdd = async () => {
    if (busy) return
    const result = await run(() => sendAddProject(path.trim(), directory), 'Failed to add the project.')
    if (result?.ok) {
      setPath('')
      setDirectory(false)
      setConfirming(false)
      onAdded()
      onClose()
    } else {
      setConfirming(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-24">
      {/* Click-away closes, same as dismissing the dropdown it was opened from. */}
      <div className="absolute inset-0" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Add project"
        className="relative w-96 max-w-[90vw] rounded-lg border border-border bg-background p-4 shadow-lg"
      >
        {confirming ? (
          // The trust confirmation (#439): a plain-language prompt-injection warning before adding.
          <>
            <p className="mb-2 text-sm font-medium">Do you trust this repository?</p>
            <p className="mb-2 break-all text-xs text-muted-foreground">
              <code className="rounded bg-muted px-1">{path.trim()}</code>
            </p>
            <p className="mb-3 text-xs text-muted-foreground">
              Adding it lets the agent read its files. Hidden instructions in an untrusted repo can hijack the agent
              (prompt injection), so only add repos you trust.
            </p>
            {error && <p className="mb-2 text-xs text-red-500">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => setConfirming(false)}>
                Back
              </Button>
              <Button type="button" size="sm" disabled={busy} onClick={() => void confirmAdd()}>
                {busy ? 'Adding…' : 'I trust it, add it'}
              </Button>
            </div>
          </>
        ) : (
          <form onSubmit={review}>
            <p className="mb-2 text-sm font-medium">Add project</p>
            <input
              value={path}
              onChange={e => setPath(e.target.value)}
              placeholder="/absolute/path/to/repo"
              aria-label="Repository path"
              autoFocus
              disabled={busy}
              className="mb-2 w-full rounded-md border border-border bg-transparent px-2 py-1 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
            />
            <label className="mb-2 flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
              <input type="checkbox" checked={directory} onChange={e => setDirectory(e.target.checked)} disabled={busy} />{' '}
              It&apos;s a folder of repos
            </label>
            {error && <p className="mb-2 text-xs text-red-500">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={busy || !path.trim()}>
                Add
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
