import type { LogEntry } from '@gemstack/the-framework'
import { onProjectLog } from '../server/reads.telefunc.js'
import { Badge } from './ui/badge.js'
import { usePolled } from '../lib/use-async.js'
import { cn } from '../lib/utils.js'
import { formatDateTime } from '../lib/format-date.js'
import { STATUS_TONE } from '../lib/status-tone.js'
import { ScrollArea } from './ui/scroll-area.js'

// The committed project log (#378/#379): `.the-framework/LOGS.md`, every finished
// loop/prompt/build run newest-first, over a Telefunc RPC (server/reads.telefunc.ts).
// Polled like the sibling rail panels, so an entry a run appends on finishing shows up
// without a project switch.
export function ProjectLogPanel({ projectId }: { projectId: string | null }) {
  const { value: logs, loaded } = usePolled<LogEntry[]>(projectId ? () => onProjectLog(projectId) : null, [], 10_000, [projectId])

  if (!projectId) return null
  // Loading and empty are different facts (#948) — same guard as the Tickets panel.
  if (!loaded) return <p className="p-4 text-sm text-muted-foreground">Loading…</p>
  if (logs.length === 0) return <p className="p-4 text-sm text-muted-foreground">No committed log entries yet.</p>

  return (
    <ScrollArea className="min-h-0 flex-auto">
      <ul className="divide-y divide-border">
      {logs.map((log, i) => (
        <li key={i} className="px-4 py-2">
          <div className="flex items-center gap-2">
            <Badge className="text-[10px] uppercase text-muted-foreground">{log.kind}</Badge>
            <Badge className={cn('border-transparent px-0 text-[10px] uppercase', STATUS_TONE[log.status])}>{log.status}</Badge>
            <span className="ml-auto text-xs text-muted-foreground">{formatDateTime(log.at)}</span>
          </div>
          <p className="mt-1 text-sm">{log.title}</p>
        </li>
      ))}
      </ul>
    </ScrollArea>
  )
}
