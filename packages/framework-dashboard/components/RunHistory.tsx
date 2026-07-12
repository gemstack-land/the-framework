import { useEffect, useState } from 'react'
import type { RunMeta } from '@gemstack/framework'
import { onRuns } from '../server/reads.telefunc.js'
import { Button } from './ui/button.js'
import { Badge } from './ui/badge.js'
import { cn } from '../lib/utils.js'

const STATUS_TONE: Record<string, string> = {
  running: 'text-primary',
  done: 'text-emerald-500',
  stopped: 'text-amber-500',
  failed: 'text-red-500',
}

// The Runs rail (#314 second sidebar): the selected project's archived runs over a
// Telefunc RPC (server/reads.telefunc.ts). "Live" returns to the live stream; picking a
// run replays it in the main view. Polls so a run that just finished shows up.
export function RunHistory({
  projectId,
  selectedRunId,
  onSelect,
}: {
  projectId: string | null
  selectedRunId: string | null
  onSelect: (runId: string | null) => void
}) {
  const [runs, setRuns] = useState<RunMeta[]>([])

  useEffect(() => {
    if (!projectId) {
      setRuns([])
      return
    }
    let live = true
    const load = () => void onRuns(projectId).then(list => live && setRuns(list))
    load()
    const poll = setInterval(load, 5000)
    return () => {
      live = false
      clearInterval(poll)
    }
  }, [projectId])

  if (!projectId) return null

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-border">
      <div className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Runs</div>
      <div className="flex-1 overflow-y-auto px-2">
        <Button
          variant="ghost"
          className={cn('mb-1 w-full justify-start', selectedRunId === null && 'bg-accent text-accent-foreground')}
          onClick={() => onSelect(null)}
        >
          <span className="mr-2 inline-block h-2 w-2 animate-pulse rounded-full bg-primary" /> Live
        </Button>
        {runs.length === 0 && <p className="px-2 py-1 text-sm text-muted-foreground">No runs yet.</p>}
        {runs.map(run => (
          <Button
            key={run.id}
            variant="ghost"
            className={cn(
              'mb-0.5 h-auto w-full flex-col items-start gap-0.5 px-2 py-2 text-left',
              run.id === selectedRunId && 'bg-accent text-accent-foreground',
            )}
            onClick={() => onSelect(run.id)}
          >
            <span className="flex w-full items-center gap-2">
              <Badge className={cn('shrink-0 border-transparent px-0 text-[10px] uppercase', STATUS_TONE[run.status])}>
                {run.status}
              </Badge>
              <span className="truncate text-xs font-normal text-muted-foreground">
                {new Date(run.startedAt).toLocaleString()}
              </span>
            </span>
            <span className="w-full truncate text-sm font-medium">{run.intent || '(no prompt)'}</span>
          </Button>
        ))}
      </div>
    </aside>
  )
}
