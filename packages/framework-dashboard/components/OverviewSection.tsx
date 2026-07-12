import { useEffect, useState } from 'react'
import type { Overview } from '@gemstack/framework'
import { onOverview } from '../server/reads.telefunc.js'
import { Badge } from './ui/badge.js'
import { cn } from '../lib/utils.js'

// The first-sidebar Overview (#437, part of #314): a cross-project glance at what the agent
// is working on right now, the size of the TODO backlog, and the recently active projects.
// Reads the `onOverview` Telefunc RPC (a rollup of the live run meta + queue + last activity),
// polled so it tracks runs starting/finishing. Clicking a project selects it.
export function OverviewSection({
  selectedId,
  onSelect,
}: {
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const [overview, setOverview] = useState<Overview | null>(null)
  const [open, setOpen] = useState(true)

  useEffect(() => {
    let live = true
    const load = () => void onOverview().then(o => live && setOverview(o))
    load()
    const poll = setInterval(load, 5000)
    return () => {
      live = false
      clearInterval(poll)
    }
  }, [])

  const activeCount = overview?.active.length ?? 0

  return (
    <div className="border-b border-border">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex w-full items-center gap-2 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground"
      >
        <span className={cn('transition-transform', open && 'rotate-90')}>›</span>
        Overview
        {activeCount > 0 && (
          <span className="ml-auto flex items-center gap-1 text-primary">
            <span className="h-2 w-2 animate-pulse rounded-full bg-primary" />
            {activeCount}
          </span>
        )}
      </button>
      {open && (
        <div className="px-4 pb-3 text-sm">
          {overview === null ? (
            <p className="text-muted-foreground">Loading…</p>
          ) : (
            <>
              <Group label="Working now">
                {overview.active.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Nothing running.</p>
                ) : (
                  overview.active.map(run => (
                    <button
                      key={run.projectId}
                      type="button"
                      onClick={() => onSelect(run.projectId)}
                      className={cn(
                        'flex w-full flex-col items-start gap-0.5 rounded px-2 py-1 text-left hover:bg-accent hover:text-accent-foreground',
                        run.projectId === selectedId && 'bg-accent text-accent-foreground',
                      )}
                    >
                      <span className="flex w-full items-center gap-1.5">
                        <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-primary" />
                        <span className="truncate font-medium">{run.projectName}</span>
                      </span>
                      {(run.intent || run.scope) && (
                        <span className="truncate pl-3.5 text-xs text-muted-foreground" title={run.intent || run.scope}>
                          {run.intent || run.scope}
                        </span>
                      )}
                    </button>
                  ))
                )}
              </Group>

              <Group label="Queue">
                <p className="px-2 text-xs text-muted-foreground">
                  {overview.queueOpen === 0
                    ? 'No open TODOs.'
                    : `${overview.queueOpen} open ${overview.queueOpen === 1 ? 'item' : 'items'} across all projects`}
                </p>
              </Group>

              {overview.recent.length > 0 && (
                <Group label="Recent">
                  {overview.recent.map(p => (
                    <button
                      key={p.projectId}
                      type="button"
                      onClick={() => onSelect(p.projectId)}
                      className={cn(
                        'flex w-full items-center gap-2 rounded px-2 py-1 text-left hover:bg-accent hover:text-accent-foreground',
                        p.projectId === selectedId && 'bg-accent text-accent-foreground',
                      )}
                    >
                      <span className="truncate text-xs">{p.projectName}</span>
                      {p.lastActivityAt && (
                        <Badge className="ml-auto shrink-0 text-[10px] text-muted-foreground">
                          {new Date(p.lastActivityAt).toLocaleDateString()}
                        </Badge>
                      )}
                    </button>
                  ))}
                </Group>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-2 last:mb-0">
      <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">{label}</div>
      {children}
    </div>
  )
}
