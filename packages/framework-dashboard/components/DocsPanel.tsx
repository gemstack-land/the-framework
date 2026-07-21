import { useState } from 'react'
import type { WorkspaceDoc } from '@gemstack/framework'
import { onDocs } from '../server/reads.telefunc.js'
import { Button } from './ui/button.js'
import { Markdown } from './Markdown.js'
import { usePolled } from '../lib/use-async.js'
import { cn } from '../lib/utils.js'
import { ScrollArea } from './ui/scroll-area.js'

// The surfaced documents (#319/#328): the PLAN/TODO the agent writes, rendered beside
// the run. Telefunc RPC (server/reads.telefunc.ts), polled so edits mid-run show up.
export function DocsPanel({ projectId }: { projectId: string | null }) {
  const { value: docs, loaded } = usePolled<WorkspaceDoc[]>(projectId ? () => onDocs(projectId) : null, [], 4000, [projectId])
  const [active, setActive] = useState(0)

  if (!projectId) return null
  // Loading and empty are different facts (#948): without the guard, a project with docs
  // flashed "No PLAN/TODO docs yet." on every open while the first read was still out.
  if (!loaded) return <p className="p-4 text-sm text-muted-foreground">Loading…</p>
  if (docs.length === 0) return <p className="p-4 text-sm text-muted-foreground">No PLAN/TODO docs yet.</p>

  const current = docs[Math.min(active, docs.length - 1)]!
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap gap-1 border-b border-border p-2">
        {docs.map((d, i) => (
          <Button
            key={d.name}
            variant="ghost"
            size="sm"
            className={cn('h-7 text-xs', i === active && 'bg-accent text-accent-foreground')}
            onClick={() => setActive(i)}
          >
            {d.name}
          </Button>
        ))}
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="p-4">
          <Markdown text={current.content} />
        </div>
      </ScrollArea>
    </div>
  )
}
