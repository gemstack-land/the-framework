import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { sendAddProject } from '../server/projects.telefunc.js'
import { useAction } from '../lib/use-action.js'
import { Button } from './ui/button.js'
import { Checkbox } from './ui/checkbox.js'

// Add project(s) (#396/#433): install a single repo, or every git repo directly under a
// directory, and register each so it joins the list. The daemon does the work; this posts
// the path over the `sendAddProject` telefunction and reloads on success.
//
// Lifted out of the projects sidebar when #772 replaced that rail with a navbar dropdown:
// the picker has no room for a two-step form, so it opens this as a small modal instead.
// It behaves like the dialog it claims to be (#948): Esc closes, Tab stays inside, focus
// returns to the opener on close, and a directory add reports how many repos it registered
// instead of silently vanishing.
export function AddProjectPanel({ onAdded, onClose }: { onAdded: () => void; onClose: () => void }) {
  const [path, setPath] = useState('')
  const [directory, setDirectory] = useState(false)
  const { busy, error, reset, run } = useAction()
  // Trust gate (#439/#314): adding a repo lets the agent read its files, so an untrusted
  // repo is a prompt-injection risk. Confirm trust before actually installing.
  const [confirming, setConfirming] = useState(false)
  // What actually got registered, shown before closing — a folder-of-repos add used to
  // register any number of projects with zero feedback.
  const [added, setAdded] = useState<{ added: number; alreadyActivated: number } | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  // Give focus back to the control that opened the dialog (the picker's Add item is gone by
  // then, so its trigger is the stable target).
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    return () => opener?.focus()
  }, [])

  // Auto-close a beat after success; Done closes sooner.
  useEffect(() => {
    if (!added) return
    const timer = setTimeout(onClose, 2500)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [added])

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
      setConfirming(false)
      setAdded({ added: result.added, alreadyActivated: result.alreadyActivated })
      onAdded()
    } else {
      setConfirming(false)
    }
  }

  // The dialog contract: Esc closes; Tab cycles inside rather than escaping to the page.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
      return
    }
    if (e.key !== 'Tab' || !panelRef.current) return
    const focusable = [...panelRef.current.querySelectorAll<HTMLElement>('button, input, [tabindex]:not([tabindex="-1"])')].filter(
      el => !el.hasAttribute('disabled'),
    )
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (!first || !last) return
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }

  const summary =
    added &&
    [
      `Added ${added.added} project${added.added === 1 ? '' : 's'}`,
      added.alreadyActivated > 0 ? `${added.alreadyActivated} already added` : null,
    ]
      .filter(Boolean)
      .join(' · ')

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-24" onKeyDown={onKeyDown}>
      {/* Click-away closes, same as dismissing the dropdown it was opened from. */}
      <div className="absolute inset-0" onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Add project"
        className="relative w-96 max-w-[90vw] rounded-lg border border-border bg-background p-4 shadow-lg"
      >
        {added ? (
          <>
            <p role="status" className="mb-3 text-sm font-medium">
              {summary}
            </p>
            <div className="flex justify-end">
              <Button type="button" size="sm" autoFocus onClick={onClose}>
                Done
              </Button>
            </div>
          </>
        ) : confirming ? (
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
            {error && <p className="mb-2 text-xs text-danger">{error}</p>}
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
              <Checkbox checked={directory} onCheckedChange={setDirectory} disabled={busy} />
              It&apos;s a folder of repos
            </label>
            {error && <p className="mb-2 text-xs text-danger">{error}</p>}
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
