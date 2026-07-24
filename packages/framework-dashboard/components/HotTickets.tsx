import type { HotTicket, HotBucket } from '@gemstack/the-framework'
import { Flame } from 'lucide-react'
import { onHotTickets } from '../server/reads.telefunc.js'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card.js'
import { usePolled } from '../lib/use-async.js'
import { cn } from '../lib/utils.js'

// The Overview's "hot tickets" card (#1112): a cross-project glance at what the agent is working on
// (planned/spiked), what is likely next (high priority), and the queued rest. A projection of every
// project's `tickets/` over the `onHotTickets` read, polled so it stays live. Selecting a ticket
// jumps into its project. Advertised on the landing page, so it earns a place on the landing view.

const EMPTY: HotTicket[] = []

// The three lanes, in the order Rom listed them (#1112): worked-on, next, queued. Each carries the
// dot colour that matches the rest of the status vocabulary (primary = active, warning = soon).
// Stacked as full-width sections rather than columns, so an uneven split (the common case, where
// most tickets sit queued) still reads as designed instead of two empty columns.
const LANES: { key: HotBucket; label: string; dot: string }[] = [
  { key: 'in-progress', label: 'In progress', dot: 'bg-primary' },
  { key: 'next', label: 'Up next', dot: 'bg-warning' },
  { key: 'queued', label: 'Queued', dot: 'bg-muted-foreground' },
]

// A lane is capped so the card stays a glance; the rest is summarised as "+N more".
const PER_LANE = 5

export function HotTickets({ onSelectProject }: { onSelectProject: (id: string) => void }) {
  const { value: tickets } = usePolled<HotTicket[]>(onHotTickets, EMPTY, 10_000, [])

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Flame className="h-4 w-4 text-muted-foreground" />
          Hot tickets
        </CardTitle>
      </CardHeader>
      <CardContent>
        {tickets.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">No tickets yet.</p>
        ) : (
          <div className="divide-y divide-border">
            {LANES.map(lane => (
              <Lane key={lane.key} lane={lane} tickets={tickets.filter(t => t.bucket === lane.key)} onSelectProject={onSelectProject} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function Lane({
  lane,
  tickets,
  onSelectProject,
}: {
  lane: { key: HotBucket; label: string; dot: string }
  tickets: HotTicket[]
  onSelectProject: (id: string) => void
}) {
  const shown = tickets.slice(0, PER_LANE)
  const more = tickets.length - shown.length
  const empty = tickets.length === 0
  return (
    <div className="py-3 first:pt-0 last:pb-0">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide">
        {/* An empty lane dims to a single header line rather than a paragraph, so the populated
            lane carries the card and the zeros still say "nothing here" at a glance. */}
        <span aria-hidden className={cn('h-2 w-2 shrink-0 rounded-full', lane.dot, empty && 'opacity-40')} />
        <span className={empty ? 'text-muted-foreground' : 'text-foreground/80'}>{lane.label}</span>
        <span className="tabular-nums text-muted-foreground/70">{tickets.length}</span>
      </div>
      {!empty && (
        <ul className="mt-1.5">
          {shown.map(t => (
            <li key={`${t.projectId}:${t.ticket.file}`}>
              <button
                type="button"
                onClick={() => onSelectProject(t.projectId)}
                title={t.ticket.summary || t.ticket.title}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
              >
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{t.ticket.title}</span>
                <TicketTag ticket={t} />
                <span className="shrink-0 text-xs text-muted-foreground">{t.projectName}</span>
              </button>
            </li>
          ))}
          {more > 0 && (
            <li className="px-2 pt-0.5 text-xs text-muted-foreground">
              +{more} more
            </li>
          )}
        </ul>
      )}
    </div>
  )
}

// The one fact that earns the lane: the plan/spike that made it in-progress, or the priority that
// made it next. Queued rows carry nothing extra — the lane already says it.
function TicketTag({ ticket: t }: { ticket: HotTicket }) {
  const tag = t.bucket === 'in-progress' ? (t.ticket.planned ? 'planned' : t.ticket.spiked ? 'spiked' : null) : t.bucket === 'next' ? t.ticket.priority ?? null : null
  if (!tag) return null
  return (
    <span className="shrink-0 rounded border border-border px-1 text-[10px] uppercase tracking-wide text-muted-foreground">
      {tag}
    </span>
  )
}
