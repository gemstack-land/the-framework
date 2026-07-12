import { useEffect, useState } from 'react'
import type { WorkspaceDoc } from '@gemstack/framework'
import { onDocs } from '../server/reads.telefunc.js'
import { Button } from './ui/button.js'
import { Markdown } from './Markdown.js'
import { cn } from '../lib/utils.js'

// The surfaced documents (#319/#328): the PLAN/TODO the agent writes, rendered beside
// the run. Telefunc RPC (server/reads.telefunc.ts), polled so edits mid-run show up.
export function DocsPanel({ projectId }: { projectId: string | null }) {
  const [docs, setDocs] = useState<WorkspaceDoc[]>([])
  const [active, setActive] = useState(0)

  useEffect(() => {
    if (!projectId) {
      setDocs([])
      return
    }
    let live = true
    const load = () => void onDocs(projectId).then(list => live && setDocs(list))
    load()
    const poll = setInterval(load, 4000)
    return () => {
      live = false
      clearInterval(poll)
    }
  }, [projectId])

  if (!projectId) return null
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
      <div className="flex-1 overflow-y-auto p-4">
        <Markdown text={current.content} />
      </div>
    </div>
  )
}
