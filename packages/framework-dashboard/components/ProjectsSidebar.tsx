import { useCallback, useEffect, useState, type FormEvent } from 'react'
import type { ProjectSummary } from '@gemstack/framework'
import { onProjects, sendAddProject } from '../server/projects.telefunc.js'
import { OverviewSection } from './OverviewSection.js'
import { QueueSection } from './QueueSection.js'
import { Button } from './ui/button.js'
import { cn } from '../lib/utils.js'

// The Projects sidebar (#406/#314). Loads the registry over a Telefunc RPC and lets the
// user pick which project's live stream to watch, or add a new one (#396/#433) via the
// daemon's own install + register. A registry that is empty (no project added yet) shows
// the how-to hint rather than a blank rail.
export function ProjectsSidebar({
  selectedId,
  onSelect,
}: {
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null)

  const reload = useCallback(
    (autoSelect: boolean) => {
      void onProjects().then(list => {
        setProjects(list)
        // Auto-select the first project when nothing is selected, or when the remembered
        // selection (#475) points at a project that no longer exists.
        const selectionExists = selectedId !== null && list.some(p => p.id === selectedId)
        if (autoSelect && list[0] && !selectionExists) onSelect(list[0].id)
      })
    },
    [selectedId, onSelect],
  )

  useEffect(() => {
    reload(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-border">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <OverviewSection selectedId={selectedId} onSelect={onSelect} />
        <QueueSection selectedId={selectedId} onSelect={onSelect} />
        <div className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Projects</div>
        <div className="px-2">
          {projects === null && <p className="px-2 py-1 text-sm text-muted-foreground">Loading…</p>}
          {projects?.length === 0 && (
            <p className="px-2 py-1 text-sm text-muted-foreground">
              No projects yet. Add one below, or run <code className="rounded bg-muted px-1">framework</code> in a repo.
            </p>
          )}
          {projects?.map(p => (
          <Button
            key={p.id}
            variant="ghost"
            className={cn(
              'mb-0.5 h-auto w-full flex-col items-start gap-0.5 px-2 py-2 text-left',
              p.id === selectedId && 'bg-accent text-accent-foreground',
            )}
            onClick={() => onSelect(p.id)}
          >
            <span className="flex w-full items-center gap-2">
              <span
                className={cn('h-2 w-2 shrink-0 rounded-full', p.activated ? 'bg-primary' : 'bg-muted-foreground')}
                title={p.activated ? 'activated' : 'not activated'}
              />
              <span className="truncate font-medium">{p.name}</span>
            </span>
            <span className="truncate pl-4 text-xs font-normal text-muted-foreground">
              {p.lastActivityAt ? new Date(p.lastActivityAt).toLocaleString() : 'no activity yet'}
            </span>
          </Button>
          ))}
        </div>
      </div>
      <AddProject onAdded={() => reload(true)} />
    </aside>
  )
}

// Add project(s) (#396/#433): install a single repo, or every git repo directly under a
// directory, and register each so it joins the list. The daemon does the work; this posts
// the path over the `sendAddProject` telefunction and reloads on success.
function AddProject({ onAdded }: { onAdded: () => void }) {
  const [open, setOpen] = useState(false)
  const [path, setPath] = useState('')
  const [directory, setDirectory] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Trust gate (#439/#314): adding a repo lets the agent read its files, so an untrusted
  // repo is a prompt-injection risk. Confirm trust before actually installing.
  const [confirming, setConfirming] = useState(false)

  // Step 1: the user submits the path -> show the trust confirmation, don't add yet.
  const review = (e: FormEvent) => {
    e.preventDefault()
    if (!path.trim() || busy) return
    setError(null)
    setConfirming(true)
  }

  // Step 2: trust confirmed -> install + register.
  const confirmAdd = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const result = await sendAddProject(path.trim(), directory)
      if (result.ok) {
        setPath('')
        setDirectory(false)
        setConfirming(false)
        setOpen(false)
        onAdded()
      } else {
        setError(result.error)
        setConfirming(false)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add the project.')
      setConfirming(false)
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <div className="border-t border-border p-2">
        <Button variant="outline" size="sm" className="w-full" onClick={() => setOpen(true)}>
          + Add project
        </Button>
      </div>
    )
  }

  // The trust confirmation (#439): a plain-language prompt-injection warning before adding.
  if (confirming) {
    return (
      <div className="border-t border-border p-3">
        <p className="mb-2 text-xs font-medium">Do you trust this repository?</p>
        <p className="mb-2 break-all text-xs text-muted-foreground">
          <code className="rounded bg-muted px-1">{path.trim()}</code>
        </p>
        <p className="mb-3 text-xs text-muted-foreground">
          Adding it lets the agent read its files. Hidden instructions in an untrusted repo can hijack the agent
          (prompt injection) — only add repos you trust.
        </p>
        {error && <p className="mb-2 text-xs text-red-500">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => setConfirming(false)}>
            Back
          </Button>
          <Button type="button" size="sm" disabled={busy} onClick={() => void confirmAdd()}>
            {busy ? 'Adding…' : 'I trust it — add'}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <form onSubmit={review} className="border-t border-border p-3">
      <input
        value={path}
        onChange={e => setPath(e.target.value)}
        placeholder="/absolute/path/to/repo"
        autoFocus
        disabled={busy}
        className="mb-2 w-full rounded-md border border-border bg-transparent px-2 py-1 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
      />
      <label className="mb-2 flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
        <input type="checkbox" checked={directory} onChange={e => setDirectory(e.target.checked)} disabled={busy} /> It&apos;s a folder of repos
      </label>
      {error && <p className="mb-2 text-xs text-red-500">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={busy || !path.trim()}>
          Add
        </Button>
      </div>
    </form>
  )
}
