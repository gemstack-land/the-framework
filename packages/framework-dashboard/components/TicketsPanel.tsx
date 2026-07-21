import { useState } from 'react'
import type { WorkspaceTicket } from '@gemstack/framework'
import { ListPlus, Check } from 'lucide-react'
import { onTickets } from '../server/reads.telefunc.js'
import { sendQueueTicket, sendStart } from '../server/control.telefunc.js'
import { Button } from './ui/button.js'
import { Badge } from './ui/badge.js'
import { usePolled } from '../lib/use-async.js'
import { useAction } from '../lib/use-action.js'
import { cn } from '../lib/utils.js'
import { ScrollArea } from './ui/scroll-area.js'

/**
 * The prompt behind "Import tickets from GitHub" (#697). Deliberately short: the agent has
 * `gh` and the ticket format already, and #674 settled that over-specifying a preset earns
 * nothing the context fragment does not already carry.
 */
const IMPORT_PROMPT =
  'Import this repo\'s open GitHub issues into tickets/, one file per issue, following the ticket format.'

/** How a priority reads, for the ones the format names. */
const PRIORITY_TONE: Record<string, string> = {
  urgent: 'text-danger',
  high: 'text-warning',
  medium: 'text-muted-foreground',
  low: 'text-muted-foreground',
}

// The tickets view (#697): the project's `tickets/*.md`, so the backlog the agent plans from
// is readable without opening the repo. Each row can be put on the agent queue, and an empty
// `tickets/` offers to import the repo's GitHub issues instead of just saying "nothing here".
export function TicketsPanel({
  projectId,
  onRunStarted,
}: {
  projectId: string | null
  /** Told when the import session starts, so the shell can show it (#948) — the button used
   *  to flip "Starting…" and leave you staring at the still-empty panel. */
  onRunStarted?: ((intent: string, runId?: string) => void) | undefined
}) {
  const { value: tickets, loaded } = usePolled<WorkspaceTicket[]>(
    projectId ? () => onTickets(projectId) : null,
    [],
    10_000,
    [projectId],
  )
  // Which tickets this session has queued. The queue is a file, not a field on the ticket, so
  // there is nothing on the ticket to re-read; remembering the click is what stops a row
  // reading as un-queued the moment the poll returns.
  const [queued, setQueued] = useState<Set<string>>(new Set())
  const { busy, error, run } = useAction()

  if (!projectId) return null
  if (!loaded) return <p className="p-4 text-sm text-muted-foreground">Loading…</p>

  const queue = async (ticket: WorkspaceTicket) => {
    const result = await run(() => sendQueueTicket(projectId, ticket.title), 'The ticket could not be queued.')
    if (result?.ok) setQueued(prev => new Set(prev).add(ticket.file))
  }

  const importFromGithub = async () => {
    const result = await run(() => sendStart(projectId, IMPORT_PROMPT, 'prompt'), 'The import could not be started.')
    // Jump to the session doing the import, so its progress is watchable instead of the
    // panel sitting empty until files land.
    if (result?.ok) onRunStarted?.(IMPORT_PROMPT, result.runId)
  }

  if (tickets.length === 0) {
    return (
      <div className="space-y-3 p-4 text-sm">
        <p className="text-muted-foreground">
          No tickets yet. Tickets live in <code className="rounded bg-muted px-1">tickets/</code> and are what the agent
          plans from.
        </p>
        {error && <p className="text-xs text-danger">{error}</p>}
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void importFromGithub()}>
          {busy ? 'Starting…' : 'Import tickets from GitHub'}
        </Button>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {error && <p className="border-b border-border p-2 text-xs text-danger">{error}</p>}
      <ScrollArea className="min-h-0 flex-1">
        <div className="p-2">
        {tickets.map(ticket => (
          <div key={ticket.file} className="mb-1 rounded border border-border p-2">
            <div className="flex items-start gap-2">
              <span className="min-w-0 flex-1 text-sm font-medium">{ticket.title}</span>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 shrink-0 gap-1 px-1.5 text-xs"
                disabled={busy || queued.has(ticket.file)}
                title={
                  queued.has(ticket.file)
                    ? 'Already added to the queue'
                    : 'Add to Queue (TODO_AGENTS.md), for the next session to work on'
                }
                onClick={() => void queue(ticket)}
              >
                {queued.has(ticket.file) ? (
                  <>
                    <Check className="h-3.5 w-3.5" /> Queued
                  </>
                ) : (
                  <>
                    <ListPlus className="h-3.5 w-3.5" /> Queue
                  </>
                )}
              </Button>
            </div>
            {ticket.summary && <p className="mt-0.5 text-xs text-muted-foreground">{ticket.summary}</p>}
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              {ticket.priority && (
                <Badge className={cn('border-transparent px-0 text-[10px] uppercase', PRIORITY_TONE[ticket.priority])}>
                  {ticket.priority}
                </Badge>
              )}
              {/* What the agent has already done to this ticket, so it is clear what is left. */}
              {ticket.spiked && <Badge className="border-transparent px-0 text-[10px] uppercase">spiked</Badge>}
              {ticket.planned && <Badge className="border-transparent px-0 text-[10px] uppercase">planned</Badge>}
              <span className="truncate text-[10px] text-muted-foreground/70">{ticket.file}</span>
            </div>
          </div>
        ))}
        </div>
      </ScrollArea>
    </div>
  )
}
