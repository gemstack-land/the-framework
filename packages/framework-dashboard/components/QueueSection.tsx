import { useEffect, useState } from 'react'
import type { ProjectQueue } from '@gemstack/framework'
import { onQueue } from '../server/reads.telefunc.js'
import { Badge } from './ui/badge.js'
import { cn } from '../lib/utils.js'

// The first-sidebar Queue (#438, part of #314). The docs rail shows one project's TODO;
// this rolls up the open TODO items across EVERY registered project so the whole backlog
// is visible in one place. Reads over the `onQueue` Telefunc RPC, polled so edits mid-run
// show up. Collapsible, and clicking a project selects it (switches the main + docs rails).
export function QueueSection({
  selectedId,
  onSelect,
}: {
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const [queues, setQueues] = useState<ProjectQueue[] | null>(null)
  const [open, setOpen] = useState(true)

  useEffect(() => {
    let live = true
    const load = () => void onQueue().then(list => live && setQueues(list))
    load()
    const poll = setInterval(load, 5000)
    return () => {
      live = false
      clearInterval(poll)
    }
  }, [])

  const totalOpen = queues?.reduce((n, q) => n + q.open, 0) ?? 0

  return (
    <div className="border-b border-border">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex w-full items-center gap-2 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground"
      >
        <span className={cn('transition-transform', open && 'rotate-90')}>›</span>
        Queue
        {totalOpen > 0 && <Badge className="ml-auto text-muted-foreground">{totalOpen}</Badge>}
      </button>
      {open && (
        <div className="max-h-64 overflow-y-auto px-2 pb-2">
          {queues === null && <p className="px-2 py-1 text-sm text-muted-foreground">Loading…</p>}
          {queues?.length === 0 && <p className="px-2 py-1 text-sm text-muted-foreground">No open TODOs.</p>}
          {queues?.map(q => (
            <div key={q.projectId} className="mb-1.5">
              <button
                type="button"
                onClick={() => onSelect(q.projectId)}
                className={cn(
                  'flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm hover:bg-accent hover:text-accent-foreground',
                  q.projectId === selectedId && 'bg-accent text-accent-foreground',
                )}
              >
                <span className="truncate font-medium">{q.projectName}</span>
                <Badge className="ml-auto shrink-0 text-muted-foreground">{q.open}</Badge>
              </button>
              <ul className="mt-0.5 space-y-0.5 pl-2">
                {q.items
                  .filter(i => !i.done)
                  .slice(0, 5)
                  .map((item, i) => (
                    <li key={i} className="flex gap-1.5 px-2 text-xs text-muted-foreground">
                      <span aria-hidden className="text-muted-foreground/60">
                        ▢
                      </span>
                      <span className="truncate" title={item.text}>
                        {item.text}
                      </span>
                    </li>
                  ))}
                {q.open > 5 && <li className="px-2 pl-5 text-xs text-muted-foreground/60">+{q.open - 5} more</li>}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
