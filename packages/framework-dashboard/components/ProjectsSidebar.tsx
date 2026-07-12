import { useEffect, useState } from 'react'
import type { ProjectSummary } from '@gemstack/framework'
import { onProjects } from '../server/projects.telefunc.js'
import { Button } from './ui/button.js'
import { cn } from '../lib/utils.js'

// The Projects sidebar (#406/#314). Loads the registry over a Telefunc RPC and lets
// the user pick which project's live stream to watch. A registry that is empty (no
// project added yet) shows the how-to hint rather than a blank rail.
export function ProjectsSidebar({
  selectedId,
  onSelect,
}: {
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null)

  useEffect(() => {
    let live = true
    void onProjects().then(list => {
      if (!live) return
      setProjects(list)
      if (list[0] && !selectedId) onSelect(list[0].id) // auto-select the first
    })
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-border">
      <div className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Projects</div>
      <div className="flex-1 overflow-y-auto px-2">
        {projects === null && <p className="px-2 py-1 text-sm text-muted-foreground">Loading…</p>}
        {projects?.length === 0 && (
          <p className="px-2 py-1 text-sm text-muted-foreground">
            No projects yet. Run <code className="rounded bg-muted px-1">framework</code> in a repo to add one.
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
    </aside>
  )
}
